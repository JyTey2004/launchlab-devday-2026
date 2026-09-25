import { readdir, readFile, writeFile, mkdir, copyFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Export an explicit source allowlist; never copy the development Git history or operator state.
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] || join(root, '.data/submission/source'));
if (output === root || root.startsWith(output + '/')) throw new Error('Choose a new export directory.');
try { await lstat(output); throw new Error('Export destination already exists. Use a new directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const files = [];
async function walk(base, callback) {
  for (const item of await readdir(base, { withFileTypes: true })) {
    if (['node_modules', '.git', '__pycache__', '.DS_Store'].includes(item.name)) continue;
    const path = join(base, item.name);
    if (item.isSymbolicLink()) throw new Error('Symlink refused: ' + relative(root, path));
    if (item.isDirectory()) await walk(path, callback); else if (item.isFile()) await callback(path);
  }
}
for (const dir of ['src', 'scripts', 'test', 'examples', 'web', 'assets', '.github']) {
  await walk(join(root, dir), path => { files.push(relative(root, path)); });
}
files.push('package.json', 'package-lock.json', '.env.example', '.gitignore');
for (const file of await readdir(join(root, 'docs'))) if (/\.(md|json)$/.test(file) && file !== 'okx-dev-day-submission.md') files.push('docs/' + file);
await walk(join(root, 'docs/submission'), path => { files.push(relative(root, path)); });
await walk(join(root, 'docs/evidence'), path => { files.push(relative(root, path)); });
for (const file of await readdir(join(root, 'deploy'))) if (file.endsWith('-evidence.json') || ['hosted-template.mjs', 'hosted-bootstrap.sh'].includes(file)) files.push('deploy/' + file);

const secrets = new Set();
for (const [key, value] of Object.entries(process.env)) if (/(SECRET|TOKEN|PASSWORD|PASSPHRASE|API_KEY|PRIVATE_KEY)/i.test(key) && value.length >= 8) secrets.add(value);
function collect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && /(?:token|password|reportKey|apiKey|secret|passphrase|accessKey)/i.test(key) && item.length >= 12) secrets.add(item);
    else if (item && typeof item === 'object') collect(item);
  }
}
await walk(join(root, '.data/hosted-operator'), async path => {
  if (path.endsWith('.json') && (await lstat(path)).size < 2000000) {
    try { collect(JSON.parse(await readFile(path, 'utf8'))); } catch { /* non-JSON operator file */ }
  }
});
const findings = [], manifest = [];
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bAKIA[A-Z0-9]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/];
const contents = new Map();
for (const path of [...new Set(files)].sort()) {
  if (path.split('/').some(p => p === '.data' || p === '.env' || p === '.git')) throw new Error('Private path refused.');
  const bytes = await readFile(join(root, path));
  const text = bytes.toString('utf8');
  if ([...secrets].some(secret => text.includes(secret))) findings.push({ file: path, rule: 'known-private-value' });
  if (patterns.some(pattern => pattern.test(text))) findings.push({ file: path, rule: 'credential-pattern' });
  contents.set(path, bytes);
  manifest.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (findings.length) { console.error(JSON.stringify({ blocked: true, findings }, null, 2)); process.exit(1); }
await mkdir(output, { recursive: true });
for (const [path, bytes] of contents) { await mkdir(dirname(join(output, path)), { recursive: true }); await writeFile(join(output, path), bytes); }
await copyFile(join(root, 'docs/submission/README.md'), join(output, 'README.md'));
manifest.push({ path: 'README.md', bytes: (await readFile(join(output, 'README.md'))).length, sha256: createHash('sha256').update(await readFile(join(output, 'README.md'))).digest('hex') });
const record = { exportedAt: new Date().toISOString(), sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceIncludesUncommittedWork: true, knownSecretScan: 'passed', credentialPatternScan: 'passed', files: manifest };
await writeFile(join(output, 'SUBMISSION_MANIFEST.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ output, fileCount: manifest.length, bytes: manifest.reduce((sum, f) => sum + f.bytes, 0), secretScan: 'passed' }, null, 2));
