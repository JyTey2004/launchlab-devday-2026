import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostedStore } from '../src/hosted/store.mjs';
import { hostedServer } from '../src/hosted/http.mjs';
import { runJob } from '../src/hosted/worker.mjs';
import { githubArchive } from '../src/managed/github-archive.mjs';

async function fixture(t, limits) {
  const dir = await mkdtemp(join(tmpdir(), 'll-hosted-')), path = join(dir, 'service.sqlite');
  const store = new HostedStore(path, limits);
  t.after(async () => { try { store.close(); } catch {} await rm(dir, { recursive: true, force: true }); });
  const a = store.createTenant('Founder A'), b = store.createTenant('Founder B');
  return { dir, path, store, a, b, ka: store.issueKey(a), kb: store.issueKey(b) };
}
const payload = { repoUrl: 'https://github.com/example/proof-reps', requestKey: 'example-key-001' };
const enqueue = (f, extra = {}) => f.store.enqueue({ tenant: f.a, workflow: 'wf_' + 'a'.repeat(20), operation: 'create', requestKey: 'example-key-001', payload, ...extra });

test('hashed, revocable service keys survive restart without storing plaintext', async (t) => {
  const f = await fixture(t);
  assert.equal(f.store.authenticate('Bearer ' + f.ka.token), f.a);
  assert.throws(() => f.store.authenticate('Bearer invalid'), /valid LaunchLab/);
  assert.equal(f.store.db.prepare('SELECT digest FROM keys WHERE id=?').get(f.ka.id).digest.length, 64);
  f.store.close();
  const restarted = new HostedStore(f.path); t.after(() => restarted.close());
  assert.equal(restarted.authenticate('Bearer ' + f.ka.token), f.a);
  restarted.revokeKey(f.ka.id);
  assert.throws(() => restarted.authenticate('Bearer ' + f.ka.token), /valid LaunchLab/);
  assert.ok(!(await readFile(f.path)).includes(Buffer.from(f.ka.token)));
});

test('durable queue deduplicates retries, rejects key conflicts, and survives reopen', async (t) => {
  const f = await fixture(t), job = enqueue(f);
  assert.equal(enqueue(f).id, job.id);
  assert.throws(() => enqueue(f, { payload: { ...payload, audience: 'changed' } }), /different input/);
  assert.throws(() => f.store.job(f.b, job.id), /not found/);
  assert.throws(() => f.store.owns(f.b, job.workflowId), /not found/);
  f.store.close();
  const restarted = new HostedStore(f.path); t.after(() => restarted.close());
  assert.equal(restarted.claim().id, job.id);
  assert.equal(restarted.claim(), null);
  restarted.recover();
  const recovered = restarted.claim(); assert.equal(recovered.recovered, 1);
  restarted.finish(recovered, { status: 'needs_input' });
  assert.equal(restarted.job(f.a, job.id).result.status, 'needs_input');
});

test('quotas apply across callers and retain uncertain model calls', async (t) => {
  const f = await fixture(t, { deployments: 1, dailyModelCalls: 2, tenantDailyModelCalls: 1, queuedPerTenant: 1 });
  const first = enqueue(f);
  assert.throws(() => enqueue(f, { workflow: 'wf_' + 'c'.repeat(20), requestKey: 'second-key-001' }), /active job limit/);
  f.store.reserveDeployment(f.a, first.workflowId); f.store.reserveDeployment(f.a, first.workflowId);
  const second = enqueue(f, { tenant: f.b, workflow: 'wf_' + 'b'.repeat(20) });
  assert.throws(() => f.store.reserveDeployment(f.b, second.workflowId), /deployment limit/);
  f.store.reserveModelCall(f.a);
  assert.throws(() => f.store.reserveModelCall(f.a), /allowance/);
  f.store.reserveModelCall(f.b);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM model_calls').get().n, 2);
});

test('public HTTP namespaces identical requests and denies cross-caller reads and writes', async (t) => {
  const f = await fixture(t); let serviceCalls = 0;
  const server = hostedServer({ store: f.store, workflows: () => { serviceCalls++; return { get: async () => { throw Object.assign(new Error('Not found'), { status: 404 }); } }; } });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, key, input) => fetch(base + path, { method: input ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key.token } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  assert.equal((await request('/api/agent/workflows', null, payload)).status, 401);
  const first = await (await request('/api/agent/workflows', f.ka, payload)).json();
  const second = await (await request('/api/agent/workflows', f.kb, payload)).json();
  assert.notEqual(first.workflowId, second.workflowId);
  assert.equal((await request('/api/agent/workflows', f.ka, payload)).status, 202);
  for (const path of [`/api/agent/jobs/${first.id}`, ...['', '/report', '/access'].map((p) => `/api/agent/workflows/${first.workflowId}${p}`)]) assert.equal((await request(path, f.kb)).status, 404);
  assert.equal((await request(`/api/agent/workflows/${first.workflowId}/resume`, f.kb, { requestKey: 'resume-test-001', expectedRevision: 1 })).status, 404);
  assert.equal(serviceCalls, 0);
  const mine = await request(`/api/agent/workflows/${first.workflowId}`, f.ka);
  assert.equal(mine.headers.get('cache-control'), 'no-store'); assert.equal((await mine.json()).status, 'queued');
  assert.equal((await request('/api/settings', f.ka)).status, 404);
  assert.equal((await request('/api/agent/workflows', f.ka, { ...payload, apiKey: 'unwanted' })).status, 400);
  assert.equal((await request('/health')).status, 503); f.store.heartbeat(); assert.equal((await request('/health')).status, 200);
});

test('interrupted GPT jobs return needs_recovery instead of repeating billed work', async (t) => {
  const f = await fixture(t), job = enqueue(f); f.store.claim(); f.store.recover();
  let calls = 0;
  const service = { load: async () => ({ status: 'planning', revision: 1, mutations: {} }),
    resume: async () => { throw Object.assign(new Error('Previous model call may be billed.'), { status: 409 }); },
    get: async () => ({ status: 'needs_recovery' }), create: async () => { calls++; } };
  await runJob(f.store, () => service, f.store.claim());
  assert.equal(calls, 0); assert.equal(f.store.job(f.a, job.id).status, 'needs_recovery');
});

test('restart reconciles an approved deployment under the same ID, and saved plans need no new GPT', async (t) => {
  const f = await fixture(t), initial = enqueue(f); f.store.finish(f.store.claim(), {});
  const job = enqueue(f, { operation: 'start', requestKey: 'start-request-001', payload: { expectedRevision: 1, planDigest: 'a'.repeat(64) } });
  f.store.claim(); f.store.recover();
  const executed = [];
  const saved = { status: 'deploying', revision: 1, approval: { planDigest: 'a'.repeat(64) }, deploymentId: 'dep_fixed' };
  const service = { load: async () => saved, resume: async () => ({ status: 'deploying' }), get: async () => ({ status: 'ready' }),
    pipeline: { authorize: async () => {}, execute: async (id) => executed.push(id) } };
  await runJob(f.store, () => service, f.store.claim());
  assert.deepEqual(executed, ['dep_fixed']); assert.equal(f.store.job(f.a, job.id).result.status, 'ready');
  assert.equal(f.store.latest(f.a, initial.workflowId).id, job.id);
});

test('an interrupted analysis is never retried automatically', async (t) => {
  const f = await fixture(t); enqueue(f); f.store.finish(f.store.claim(), {});
  const job = enqueue(f, { operation: 'analyze', requestKey: 'analyze-request-001' });
  f.store.claim(); f.store.recover(); let calls = 0;
  await runJob(f.store, () => ({ analyze: () => calls++ }), f.store.claim());
  assert.equal(calls, 0); assert.equal(f.store.job(f.a, job.id).status, 'needs_recovery');
});

test('completed analysis returns findings without reserving or reexecuting a deployment', async (t) => {
  const f = await fixture(t); enqueue(f); f.store.finish(f.store.claim(), {});
  const input = { cohort: 'test', days: '7' };
  const job = enqueue(f, { operation: 'analyze', requestKey: 'analysis-result-001', payload: input });
  const result = { workflowId: job.workflowId, revision: 3, analysis: { status: 'generated', analysisScope: 'instrumentation-only', suggestions: [] } };
  const unexpected = () => { throw new Error('Analysis must not touch deployment state'); };
  f.store.reserveDeployment = unexpected;
  await runJob(f.store, () => ({
    analyze: async (id, value) => { assert.equal(id, job.workflowId); assert.deepEqual(value, input); return result; },
    load: unexpected, get: unexpected, pipeline: { authorize: unexpected, execute: unexpected },
  }), f.store.claim());
  assert.equal(f.store.job(f.a, job.id).status, 'completed');
  assert.deepEqual(f.store.job(f.a, job.id).result, result);
});

test('GitHub archive fetch bounds redirects and never forwards credentials', async () => {
  const calls = [], token = 'fixture-github-token';
  const data = await githubArchive(payload.repoUrl, 'a'.repeat(40), token, async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/example/proof-reps/zip/a' } }) : new Response('zip');
  });
  assert.equal(data.toString(), 'zip'); assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[1].options.headers, undefined);
  await assert.rejects(githubArchive(payload.repoUrl, 'a'.repeat(40), token, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/archive' } })), /Unexpected/);
  await assert.rejects(githubArchive(payload.repoUrl, 'HEAD', token), /pinned/);
});
