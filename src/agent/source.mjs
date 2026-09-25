import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../managed/io.mjs';
import { githubArchive } from '../managed/github-archive.mjs';
import { digest, patchSource, validatePatchPath } from '../managed/instrument-patch.mjs';
const archiveScript = fileURLToPath(new URL('../managed/archive.py', import.meta.url));
export async function fetchSource(input, inspection, folder, token) {
  const file = join(folder, 'repository.zip');
  await writeFile(file, await githubArchive(input.repoUrl, inspection.source.commitSha, token), { mode: 0o600 });
  await command('python3', [archiveScript, 'source', file, join(folder, 'source'), inspection.detected.rootDirectory]);
}
export async function sourceContext(root) {
  const files = []; let total = 0;
  async function walk(path, prefix = '') {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || /^(node_modules|dist|test|tests|backend|deploy|__launchlab)$/.test(entry.name)) continue;
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlink found in source context.');
      if (entry.isDirectory()) { await walk(join(path, entry.name), relative + '/'); continue; }
      if (!/\.(html|js|mjs|jsx|ts|tsx)$/.test(entry.name)) continue;
      const content = await readFile(join(path, entry.name), 'utf8');
      if (content.length > 60000 || total + content.length > 160000 || files.length >= 30) continue;
      if (/sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN [^-]*PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(content)) throw new Error('Potential credential in frontend source. Remove it before model analysis.');
      files.push({ path: relative, content }); total += content.length;
    }
  }
  await walk(root);
  if (!files.length) throw new Error('No supported frontend source files found for instrumentation.');
  return files;
}
export function sealInstrumentation({ id, input, source, rootDirectory, design, context, receipt }) {
  const files = {}, previews = [];
  for (const path of new Set(design.patches.map((p) => p.path))) {
    validatePatchPath(path);
    const file = context.find((f) => f.path === path);
    if (!file) throw new Error('The model selected a file outside the provided frontend context.');
    const patches = design.patches.filter((p) => p.path === path);
    const after = patchSource(file.content, patches);
    files[path] = digest(file.content);
    previews.push({ path, beforeHash: files[path], afterHash: digest(after), changes: patches.map((p) => ({ anchor: p.anchor, placement: p.placement, eventId: p.eventId })) });
  }
  return { version: 1, id, source, rootDirectory, hypothesis: input.hypothesis, audience: input.audience, design, files, previews, receipt };
}
