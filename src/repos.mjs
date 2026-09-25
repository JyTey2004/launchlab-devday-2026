import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireThat, DomainError } from './store.mjs';

export const EXAMPLE_DIR = fileURLToPath(new URL('../examples/hello-xlayer/', import.meta.url));
export const NETWORK = Object.freeze({
  name: 'X Layer Testnet',
  chainId: 1952,
  hexChainId: '0x7a0',
  rpcUrl: 'https://testrpc.xlayer.tech/terigon',
  explorerUrl: 'https://www.okx.com/web3/explorer/xlayer-test',
  currency: 'OKB',
});
const safePath = z
  .string()
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:html|css|js|json|svg|txt)$/);
const manifestSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(400),
    adapter: z.literal('static'),
    entry: z.literal('index.html'),
    files: z.array(safePath).min(1).max(20),
    chainId: z.literal(1952),
  })
  .strict()
  .refine(
    (m) => m.files.includes(m.entry) && new Set(m.files).size === m.files.length,
    'Files must include index.html with no duplicates',
  );

export function parseRepository(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError('Use a public https://github.com/owner/repository URL.');
  }
  const match = url.pathname
    .replace(/\.git$/, '')
    .match(/^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/);
  requireThat(
    url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      match,
    'Use a public https://github.com/owner/repository URL.',
  );
  requireThat(!['.', '..'].includes(match[2]), 'Invalid repository name');
  return { owner: match[1], name: match[2], url: `https://github.com/${match[1]}/${match[2]}` };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  requireThat(
    response.ok,
    `Upstream request returned HTTP ${response.status}. Public repository access or rate limit may be the cause.`,
    502,
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireThat(size <= 1_500_000, 'Upstream response exceeds the size limit.', 422);
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const github = (path) =>
  jsonFetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LaunchLab/0.1',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
function digest(files) {
  const hash = createHash('sha256');
  for (const [name, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
    hash.update(`${name.length}:${name}:${Buffer.byteLength(data)}:`).update(data);
  return hash.digest('hex');
}
export async function exampleSnapshot() {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(`${EXAMPLE_DIR}/launchlab.json`, 'utf8')),
  );
  const files = Object.fromEntries(
    await Promise.all(
      manifest.files.map(async (name) => [name, await readFile(`${EXAMPLE_DIR}/${name}`, 'utf8')]),
    ),
  );
  return {
    kind: 'bundled',
    repoUrl: null,
    commitSha: null,
    manifest,
    files,
    digest: digest(files),
  };
}
export async function repositorySnapshot(repoUrl, ref = 'HEAD') {
  const repo = parseRepository(repoUrl);
  requireThat(typeof ref === 'string' && ref.length > 0 && ref.length <= 200, 'Invalid Git ref.');
  const base = `/repos/${repo.owner}/${repo.name}`;
  const commit = await github(`${base}/commits/${encodeURIComponent(ref)}`);
  requireThat(/^[a-f0-9]{40}$/.test(commit.sha), 'GitHub did not return a valid commit.', 502);
  async function content(path) {
    const file = await github(
      `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit.sha}`,
    );
    requireThat(
      file.type === 'file' && file.encoding === 'base64' && file.size <= 256_000,
      `Unsupported or oversized file: ${path}`,
      422,
    );
    const bytes = Buffer.from(file.content, 'base64');
    requireThat(bytes.length <= 256_000, 'File exceeds the size limit.', 422);
    return bytes.toString('utf8');
  }
  const manifest = manifestSchema.parse(JSON.parse(await content('launchlab.json')));
  const files = {};
  for (const name of manifest.files) files[name] = await content(name);
  requireThat(
    Object.values(files).reduce((n, text) => n + Buffer.byteLength(text), 0) <= 750_000,
    'Static project exceeds 750 KB.',
    422,
  );
  return {
    kind: 'github',
    repoUrl: repo.url,
    commitSha: commit.sha,
    manifest,
    files,
    digest: digest(files),
  };
}
export async function checkNetwork() {
  try {
    const result = await jsonFetch(NETWORK.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    requireThat(result.result === NETWORK.hexChainId, 'RPC reported an unexpected chain ID.', 502);
    return { ...NETWORK, status: 'reachable', checkedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...NETWORK,
      status: 'unavailable',
      error: error.message,
      checkedAt: new Date().toISOString(),
    };
  }
}
