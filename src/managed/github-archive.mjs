import { parseRepository } from '../repos.mjs';
import { requireThat } from '../store.mjs';

export async function githubArchive(repoUrl, commit, token, fetcher = fetch) {
  const { owner, name } = parseRepository(repoUrl);
  requireThat(/^[a-f0-9]{40}$/.test(commit), 'Source must be pinned to a commit.');
  const url = `https://api.github.com/repos/${owner}/${name}/zipball/${commit}`;
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  requireThat(response.status === 302, 'GitHub source archive is unavailable.', 502);
  const location = new URL(response.headers.get('location'));
  requireThat(location.protocol === 'https:' && location.hostname === 'codeload.github.com' && !location.username && !location.password && !location.port, 'Unexpected GitHub archive destination.', 502);
  // GitHub returns a scoped archive URL. Never forward a caller's token to redirects.
  const archive = await fetcher(location, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  requireThat(archive.ok, 'GitHub source download failed.', 502);
  const limit = 30_000_000; let total = 0; const chunks = [];
  for await (const chunk of archive.body) {
    total += chunk.length; requireThat(total <= limit, 'Repository archive exceeds 30 MB.', 413); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
