import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const commit = '76fa3ae06b8ea8a6a7fd1e58fa82723687296c72';
const repository = 'https://github.com/JyTey2004/launchlab-devday-pulse';
const execute = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');

// The public adapter transfers counts only. Drafts, opinions, feedback contents,
// timestamps and page identities stay inside the example's browser storage.
export const judgeAdapterSource = String.raw`
const names = Object.freeze(['page_view','mission_started','problem_selected','brief_created','price_signal_submitted','brief_copied','brief_exported']);
export function judgeSampleSummary(state) {
  const events = Array.isArray(state?.events) ? state.events.slice(-400) : [];
  const currentSession = typeof state?.session === 'string' ? state.session : '';
  const eventCounts = names.map(id => {
    const occurrences = currentSession ? events.filter(event => event?.name === id && event.session === currentSession).length : 0;
    return { id, occurrences, sessions: occurrences ? 1 : 0 };
  });
  const feedbackResponses = currentSession && Array.isArray(state?.feedback) && state.feedback.some(response => response?.session === currentSession) ? 1 : 0;
  return { source: 'launchlab-judge-sample', version: 1, mode: 'browser-local', scope: 'current-page-visit',
    consent: state?.consent === true, recordedSessions: eventCounts.some(event => event.occurrences > 0) ? 1 : 0,
    briefsCreated: eventCounts.find(event => event.id === 'brief_created').occurrences,
    feedbackResponses, eventCounts };
}
export function attachJudgeSummary(getState, browser = globalThis) {
  if (browser.parent === browser || !browser.parent || !browser.location
    || !/^https?:$/.test(browser.location.protocol)
    || new URLSearchParams(browser.location.search).get('judge') !== '1') return { publish() {} };
  let signature = '';
  const publish = (force = false) => {
    const summary = judgeSampleSummary(getState()), next = JSON.stringify(summary);
    if (!force && next === signature) return;
    signature = next;
    browser.parent.postMessage(summary, browser.location.origin);
  };
  browser.addEventListener('message', event => {
    const value = event.data;
    if (event.origin !== browser.location.origin || event.source !== browser.parent || !value || Array.isArray(value)
      || Object.keys(value).length !== 3 || value.source !== 'launchlab-judge-parent' || value.version !== 1 || value.type !== 'request-summary') return;
    publish(true);
  });
  return { publish };
}
`;

async function filesIn(directory, base = directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(path, base));
    else if (entry.isFile()) result.push({ path: relative(base, path).replaceAll('\\', '/'), sha256: digest(await readFile(path)) });
    else throw Error('Only regular generated files may enter the public sample.');
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error('The pinned example adapter anchor changed. No public sample was prepared.');
  return source.replace(from, to);
}

export async function buildJudgeSample(sourcePath) {
  const source = sourcePath ? resolve(sourcePath) : resolve(root, '../output/launchlab-reviewer-local-20261007/pinned-source');
  const output = join(root, 'judge-site/try/sample');
  const folder = resolve(root, '../output/launchlab-judge-sample-20261007', randomUUID());
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: join(folder, 'home'), TMPDIR: join(folder, 'tmp'), LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const [head, status, manifest, vite] = await Promise.all([
    execute('/usr/bin/git', ['-C', source, 'rev-parse', 'HEAD'], { env }),
    execute('/usr/bin/git', ['-C', source, 'status', '--porcelain'], { env }),
    readFile(join(source, 'package.json'), 'utf8'), readFile(join(source, 'node_modules/vite/package.json'), 'utf8'),
  ]);
  if (head.stdout.trim() !== commit || status.stdout.trim()) throw Error('Use the clean, reviewed local Pulse source. No clone or network operation will be attempted.');
  if (JSON.parse(manifest).devDependencies?.vite !== '8.3.1' || JSON.parse(vite).version !== '8.3.1') throw Error('The reviewed Vite dependencies must already be installed locally.');
  const sourceTree = await execute('/usr/bin/git', ['-C', source, 'ls-tree', '-r', '--name-only', commit], { env });
  if (sourceTree.stdout.split('\n').some(path => /(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|.*\.private(?:\.|$))/.test(path))) throw Error('A protected source file was found; public sample preparation stopped.');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await mkdir(env.HOME, { mode: 0o700 }); await mkdir(env.TMPDIR, { mode: 0o700 });
  const copy = join(folder, 'source'); await mkdir(copy, { mode: 0o700 });
  const archive = join(folder, 'pinned.tar');
  await execute('/usr/bin/git', ['-C', source, 'archive', '--format=tar', '--output', archive, commit], { env, timeout: 15000 });
  await execute('/usr/bin/tar', ['-xf', archive, '-C', copy], { env, timeout: 15000 });
  await cp(join(source, 'node_modules'), join(copy, 'node_modules'), { recursive: true, dereference: true });

  const validationPath = join(copy, 'src/validation.js');
  let validation = await readFile(validationPath, 'utf8');
  validation = "import { attachJudgeSummary } from './judge-adapter.js';\n" + validation;
  validation = replaceOnce(validation, 'const key = `launchlab-demo:${project}:v1`;', 'const key = `launchlab-judge-sample:${project}:v1`;');
  validation = replaceOnce(validation,
    '  const store = createObservationStore({ session, saved, storage, key });',
    `  const store = createObservationStore({ session, saved, storage, key });
  const judgeSummary = attachJudgeSummary(() => store.getState());
  const originalDispatch = store.dispatch.bind(store);
  store.dispatch = action => { const result = originalDispatch(action); if (result.changed) judgeSummary.publish(); return result; };`);
  validation = replaceOnce(validation, '  renderCounts(); renderMode(); syncHosted();', '  renderCounts(); renderMode(); syncHosted(); judgeSummary.publish();');
  await writeFile(validationPath, validation);
  await writeFile(join(copy, 'src/judge-adapter.js'), judgeAdapterSource);
  // Relative asset URLs are required when Pages hosts /try/sample/ under the
  // repository prefix. No package install, remote build or .env is involved.
  const build = await execute(process.execPath, [join(copy, 'node_modules/vite/bin/vite.js'), 'build', '--base', './'], { cwd: copy, env, timeout: 120000, maxBuffer: 1000000 });
  await writeFile(join(folder, 'build.log'), build.stdout + build.stderr, { mode: 0o600 });
  const dist = join(copy, 'dist'), index = await readFile(join(dist, 'index.html'), 'utf8');
  if (!index.includes('./assets/') || index.includes('src="/assets/')) throw Error('The sample build did not produce portable relative assets.');
  const assets = await filesIn(dist);
  if (assets.some(file => !/^(?:index\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(file.path))) throw Error('Unexpected files would enter the public sample.');
  await mkdir(join(root, 'judge-site/try'), { recursive: true });
  // Only this generated local sample directory is replaced. Parent pages and
  // the original Pulse checkout are never edited by this helper.
  await rm(output, { recursive: true, force: true }); await cp(dist, output, { recursive: true });
  const sampleManifest = { schemaVersion: 1, title: 'Dev Day Pulse — browser-local judge sample',
    source: { repository, commit }, builtAt: new Date().toISOString(), base: './', files: assets,
    build: { tool: 'Vite', version: '8.3.1', execution: 'actual offline build from committed pinned source', networkUsed: false, modelCalls: 0,
      rebuild: 'node scripts/build-judge-sample.mjs /path/to/clean/pulse',
      requirements: 'Exact pinned commit; clean Git checkout; already installed Vite 8.3.1 dependencies. No network fallback.' },
    changes: ['Separate judge-demo browser storage namespace', 'Sanitized current-page count adapter on real observation-store changes'],
    adapter: { source: 'launchlab-judge-sample', version: 1, target: 'same-origin actual parent only', scope: 'current-page-visit',
      fields: ['source','version','mode','scope','consent','recordedSessions','briefsCreated','feedbackResponses','eventCounts'],
      eventNames: ['page_view','mission_started','problem_selected','brief_created','price_signal_submitted','brief_copied','brief_exported'],
      retainedEventLimit: 400, feedbackResponsesLimit: 1,
      reset: 'Reload starts a new page visit with recording off and excludes earlier saved visits from parent counts. Clear local data clears the separate sample observations, turns recording off and leaves experience selections unchanged.',
      parentRequest: { source: 'launchlab-judge-parent', version: 1, type: 'request-summary' } },
    boundary: 'Static interactive prototype. No OKX task, wallet payment, model call, managed deployment or shared collection. Measurements and feedback remain in this browser. Counts are sessions/actions, not verified people or customer demand. A JSON export request does not prove a saved file.',
  };
  await writeFile(join(output, 'sample-manifest.json'), JSON.stringify(sampleManifest, null, 2) + '\n');
  await writeFile(join(folder, 'receipt.json'), JSON.stringify({ ...sampleManifest, publicDirectory: output }, null, 2), { mode: 0o600 });
  return { output, receipt: join(folder, 'receipt.json'), files: assets.length, sourceCommit: commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) {
    console.error('Usage: node scripts/build-judge-sample.mjs [/path/to/clean/pulse]'); process.exitCode = 1;
  } else buildJudgeSample(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
