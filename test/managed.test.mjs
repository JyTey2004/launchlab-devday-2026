import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repairPlan, chooseUpdate } from '../src/managed/build-doctor.mjs';
import { managedInput, buildRecipe, hash } from '../src/managed/contracts.mjs';
import { ManagedPipeline } from '../src/managed/pipeline.mjs';
import { infrastructure } from '../src/managed/infrastructure.mjs';
import { verifyObservationPreflight } from '../src/managed/verify-observation.mjs';
import { apiServer, listen } from '../src/http.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const brief = { requestKey: 'managed-test-001', name: 'test-app', repoUrl: 'https://github.com/example/app', hypothesis: 'Will people use this sample?', allowRepairs: true };
const inspected = { source: { commitSha: 'a'.repeat(40) }, questions: [], detected: { framework: 'vite', rootDirectory: '.', environmentKeys: [], lockfiles: [], hasBuildScript: false, runtimeReviewRequired: false, packageManager: 'npm' } };

test('deployment verification rejects health-only collectors whose browser preflight fails', async () => {
  const origin = 'https://preview.example.test', api = 'https://collector.example.test', paths = [];
  const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' };
  await assert.rejects(verifyObservationPreflight(api, origin, async () => new Response('{}', { status: 404, headers })), /preflight/);
  await assert.rejects(verifyObservationPreflight(api, origin, async () => new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-headers': 'content-type' } })), /preflight: \/events/);
  await verifyObservationPreflight(api, origin, async (url, input) => { paths.push(new URL(url).pathname); assert.equal(input.method, 'OPTIONS'); assert.equal(input.headers.Origin, origin); return new Response(null, { status: 204, headers }); });
  assert.deepEqual(paths, ['/sessions', '/events', '/feedback', '/report']);
});

test('build doctor changes only allowed stable same-major packages with explicit policy', () => {
  const original = { dependencies: { react: '19.0.0' }, devDependencies: { vite: '^8.0.0', typescript: '5.9.1' } };
  const versions = { vite: ['8.0.1', '9.0.0', '8.2.0-beta.1', '8.1.4'], typescript: ['5.9.0', '6.0.0'], react: ['19.2.0'] };
  assert.equal(chooseUpdate('8.2.0', ['8.1.9', '9.0.0']), null);
  assert.equal(chooseUpdate('workspace:*', ['8.1.4']), null);
  assert.deepEqual(repairPlan(original, false, { allowRepairs: false }, versions), { next: original, changes: [], regenerateLock: false });
  const result = repairPlan(original, false, { allowRepairs: true, refreshBuildPackages: true }, versions);
  assert.equal(result.next.devDependencies.vite, '8.1.4');
  assert.equal(result.next.devDependencies.typescript, '5.9.1');
  assert.equal(result.next.dependencies.react, '19.0.0');
  assert.equal(result.next.scripts.build, 'vite build');
  assert.equal(result.regenerateLock, true);
  assert.equal(original.scripts, undefined);
  const noRefresh = repairPlan(original, true, { allowRepairs: true, refreshBuildPackages: false }, versions);
  assert.equal(noRefresh.next.devDependencies.vite, '^8.0.0');
  assert.equal(noRefresh.regenerateLock, false);
});

test('deployment recipe stops unsupported runtimes, secrets, conflicting managers and ancestor workspaces', () => {
  const input = managedInput.parse(brief);
  assert.equal(buildRecipe(input, inspected).questions.length, 0);
  assert.ok(buildRecipe(input, { questions: [] }).questions.length);
  for (const override of [
    { framework: 'nextjs' }, { environmentKeys: ['SECRET'] }, { runtimeReviewRequired: true },
    { packageManager: 'pnpm' }, { lockfiles: [{ path: 'yarn.lock', manager: 'yarn' }] },
    { rootDirectory: 'apps/web', lockfiles: [{ path: 'package-lock.json', manager: 'npm' }] },
  ]) assert.ok(buildRecipe(input, { ...inspected, detected: { ...inspected.detected, ...override } }).questions.length);
  assert.equal(buildRecipe({ ...input, allowRepairs: false }, inspected).questions.length, 2);
  for (const outputDirectory of ['../other', '/tmp/site', 'dist/../other']) assert.throws(() => managedInput.parse({ ...brief, outputDirectory }));
  assert.throws(() => managedInput.parse({ ...brief, allowRepairs: false, refreshBuildPackages: true }));
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'managed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'hosting.json');
  await writeFile(configPath, JSON.stringify({ profile: 'test', region: 'ap-southeast-1', account: '123456789012' }));
  let inspections = 0;
  const pipeline = new ManagedPipeline({ directory: join(directory, 'runs'), configPath, inspect: async () => { inspections++; return structuredClone(inspected); } });
  pipeline.token = async () => undefined;
  return { pipeline, inspections: () => inspections };
}

test('planning pins source, is idempotent, does not provision and requires its exact confirmed digest', async (t) => {
  const { pipeline, inspections } = await fixture(t);
  const first = await pipeline.plan(brief);
  assert.equal(first.status, 'planned');
  assert.equal(first.source.commitSha, inspected.source.commitSha);
  assert.equal(first.resources, undefined);
  assert.deepEqual(await readdir(pipeline.folder(first.id)), ['run.json']);
  assert.deepEqual(await pipeline.plan(brief), first);
  assert.equal(inspections(), 1);
  await assert.rejects(pipeline.plan({ ...brief, name: 'other-app' }), /already belongs/);
  await assert.rejects(pipeline.authorize(first.id, { planDigest: '0'.repeat(64) }), /does not match/);
  assert.equal((await pipeline.authorize(first.id, { planDigest: first.planDigest })).status, 'queued');
  const second = await pipeline.plan({ ...brief, requestKey: 'managed-test-002' });
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.resourceName, first.resourceName);
  assert.notEqual((await pipeline.credentials(first)).reportKey, (await pipeline.credentials(second)).reportKey);
  const publicState = await readFile(join(pipeline.folder(first.id), 'run.json'), 'utf8');
  assert.ok(!publicState.includes((await pipeline.credentials(first)).password));
});

test('unresolved source configuration cannot be authorized', async (t) => {
  const { pipeline } = await fixture(t);
  pipeline.inspect = async () => ({ ...inspected, detected: { ...inspected.detected, framework: 'nextjs' } });
  const run = await pipeline.plan(brief);
  assert.equal(run.status, 'needs_input');
  await assert.rejects(pipeline.authorize(run.id, { planDigest: run.planDigest }), /Resolve/);
});

test('isolated build role has no deployment, report, secret or other-project permissions', () => {
  const template = infrastructure({ id: 'dep_example', resourceName: 'll-example', recipe: { nodeMajor: '22' }, input: brief }, 'def handler(a,b): return {}');
  const permissions = JSON.stringify(template.Resources.BuildRole);
  assert.ok(!/amplify:|dynamodb:|secretsmanager:|ssm:|iam:PassRole/.test(permissions));
  for (const statement of template.Resources.BuildRole.Properties.Policies[0].PolicyDocument.Statement) assert.notEqual(statement.Resource, '*');
  assert.equal(template.Resources.Builder.Properties.Environment.PrivilegedMode, false);
  assert.equal(template.Resources.Builder.Properties.TimeoutInMinutes, 10);
  assert.equal(template.Resources.App.Properties.BasicAuthConfig.EnableBasicAuth, true);
  for (const parameter of Object.values(template.Parameters)) assert.equal(parameter.NoEcho, true);
  assert.equal(hash(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('managed HTTP requires bearer access and MCP can plan, start, poll and report', async (t) => {
  const { pipeline } = await fixture(t);
  const started = [];
  pipeline.start = async (id, input) => { const run = await pipeline.authorize(id, input); started.push(id); return run; };
  pipeline.report = async (id, filter) => ({ project: id, ...filter, sessions: 0 });
  const server = apiServer({}, {}, 'operator-test-token', pipeline);
  const port = await listen(server, 0), origin = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((r) => server.close(r)));
  const denied = await fetch(origin + '/api/managed-deployments', { headers: { Origin: origin } });
  assert.equal(denied.status, 403);
  assert.equal((await pipeline.list()).length, 0);
  const client = new Client({ name: 'managed-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], env: { ...process.env, LAUNCHLAB_URL: origin, LAUNCHLAB_API_TOKEN: 'operator-test-token' }, stderr: 'pipe' }));
  t.after(() => client.close());
  async function call(name, args) { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); }
  const plan = await call('launchlab_plan_deployment', brief);
  assert.equal(plan.status, 'planned'); assert.equal(started.length, 0);
  const wrong = await client.callTool({ name: 'launchlab_start_deployment', arguments: { deploymentId: plan.id, planDigest: '0'.repeat(64) } });
  assert.equal(wrong.isError, true); assert.equal(started.length, 0);
  assert.equal((await call('launchlab_start_deployment', { deploymentId: plan.id, planDigest: plan.planDigest })).status, 'queued');
  assert.equal((await call('launchlab_get_deployment', { deploymentId: plan.id })).source.commitSha, inspected.source.commitSha);
  assert.equal((await call('launchlab_deployment_report', { deploymentId: plan.id, cohort: 'test', days: '30' })).cohort, 'test');
});

test('archive boundaries and generic experiment collector pass Python verification', () => {
  execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'test/managed', '-p', 'test_*.py'], { encoding: 'utf8', timeout: 30000 });
});
