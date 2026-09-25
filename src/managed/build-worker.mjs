import { readFile, writeFile, mkdir, cp, lstat, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ALLOWED_PACKAGES, repairPlan } from './build-doctor.mjs';
import { applyInstrumentation } from './instrument-patch.mjs';

const base = process.cwd();
const app = resolve(base, 'app');
const job = JSON.parse(await readFile(join(base, '.launchlab/job.json'), 'utf8'));
const report = { engine: 'bounded-rules-v1', sourceCommit: job.commitSha, changes: [], status: 'started', node: process.version, outputs: [] };
const evidence = join(base, 'delivery/evidence');
const site = join(base, 'delivery/site');
await mkdir(evidence, { recursive: true });
function run(bin, args, timeout = 240000) {
  const result = spawnSync(bin, args, { cwd: app, encoding: 'utf8', timeout, maxBuffer: 2_000_000, env: { ...process.env, CI: 'true', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/' } });
  if (result.status !== 0) {
    // Diagnostic tail remains in private CodeBuild logs, never a public page.
    console.error(String(result.stdout || '').slice(-3000), String(result.stderr || '').slice(-3000));
    throw new Error(`${bin} ${args[0]} failed. Resolve the build log; no automatic arbitrary code edits were attempted.`);
  }
  return result.stdout;
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
try {
  if (job.instrumentation) {
    report.instrumentation = { experimentId: job.instrumentation.id, sourceCommit: job.commitSha, changes: await applyInstrumentation(app, job.instrumentation) };
    await writeFile(join(evidence, 'instrumentation.json'), JSON.stringify({ ...report.instrumentation, patches: job.instrumentation.design.patches }, null, 2) + '\n');
  }
  if (job.recipe.framework === 'vite') {
    const original = await readFile(join(app, 'package.json'), 'utf8');
    const pkg = JSON.parse(original), versions = {};
    if (job.recipe.allowRepairs && job.recipe.refreshBuildPackages) {
      for (const name of ALLOWED_PACKAGES) {
        const current = pkg.devDependencies?.[name] || pkg.dependencies?.[name];
        const major = current?.match(/^[~^]?(\d+)\.\d+\.\d+$/)?.[1];
        if (!major) continue;
        const result = JSON.parse(run('npm', ['view', `${name}@${major}`, 'version', '--json', '--registry=https://registry.npmjs.org/'], 60000));
        versions[name] = Array.isArray(result) ? result : [result];
      }
    }
    const planned = repairPlan(pkg, await exists(join(app, 'package-lock.json')), job.recipe, versions);
    report.changes = planned.changes;
    if (planned.changes.length) {
      const updated = JSON.stringify(planned.next, null, 2) + '\n';
      await writeFile(join(app, 'package.json'), updated);
      // A standard unified patch, containing only reviewed package metadata.
      await writeFile(join(base, '.launchlab/package-before.json'), original);
      const diff = spawnSync('diff', ['-u', '--label', 'a/package.json', '--label', 'b/package.json', join(base, '.launchlab/package-before.json'), join(app, 'package.json')], { encoding: 'utf8' });
      await writeFile(join(evidence, 'package.patch'), diff.stdout || '');
    }
    if (planned.regenerateLock) run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    run('npm', ['run', 'build', '--ignore-scripts']);
    if (await exists(join(app, 'package-lock.json'))) await cp(join(app, 'package-lock.json'), join(evidence, 'package-lock.json'));
  }
  const output = resolve(app, job.recipe.outputDirectory);
  if (output !== app && !output.startsWith(app + '/')) throw new Error('Output directory escapes the app.');
  if (!(await exists(join(output, 'index.html')))) throw new Error('Build output does not contain index.html; confirm outputDirectory.');
  let size = 0, count = 0;
  async function copy(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'].includes(entry.name)) continue;
      const source = join(directory, entry.name), path = relative(output, source);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw new Error('Build output includes a symlink.');
      if (stat.isDirectory()) await copy(source);
      else {
        if (!/\.(html|js|mjs|css|json|svg|png|jpg|jpeg|webp|gif|ico|avif|woff2?|ttf|txt|wasm|webmanifest|mp4)$/.test(path)) throw new Error('Unsupported public output: ' + path);
        size += stat.size; count++;
        if (size > job.recipe.limits.outputBytes || count > job.recipe.limits.files) throw new Error('Build output exceeds deployment limits.');
        await mkdir(resolve(site, path, '..'), { recursive: true });
        await cp(source, join(site, path));
        report.outputs.push({ path, sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
      }
    }
  }
  await copy(output);
  report.status = 'passed'; report.outputBytes = size;
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
await writeFile(join(evidence, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, repairCount: report.changes.length, outputFiles: report.outputs.length, error: report.error }));
