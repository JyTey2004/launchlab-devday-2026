import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HostedStore } from '../src/hosted/store.mjs';
import { hostedServer } from '../src/hosted/http.mjs';
import { runJob } from '../src/hosted/worker.mjs';
import { fixture, repoUrl, brief, commit } from './helpers/workflow-fixture.mjs';

async function setup(t, options) {
  const f = await fixture(t, options);
  const store = new HostedStore(join(f.directory, 'provider.sqlite'));
  const a = store.createTenant('buyer-a'), b = store.createTenant('buyer-b');
  const ka = store.issueKey(a), kb = store.issueKey(b);
  f.pipeline.start = (id, approval) => f.pipeline.authorize(id, approval);
  f.pipeline.execute = async (id) => { f.starts.push(id); return f.complete(id); };
  const server = hostedServer({ store, workflows: () => f.workflows });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); store.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (action, input, key = ka) => {
    const response = await fetch(origin + '/api/okx/invoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key.token } : {}) },
      body: JSON.stringify({ action, input }),
    });
    return { status: response.status, value: await response.json(), headers: response.headers };
  };
  const work = async () => { const job = store.claim(); assert.ok(job); await runJob(store, () => f.workflows, job); return store.job(job.tenant, job.id); };
  const mcp = async (key = ka) => {
    const client = new Client({ name: 'provider-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/api/okx/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + key.token } } }));
    t.after(() => client.close());
    return client;
  };
  return { ...f, store, a, b, ka, kb, origin, request, work, mcp };
}

test('remote MCP completes repo → clarification → approval → verified deployment → results using the real coordinator and durable worker', async (t) => {
  const f = await setup(t), client = await f.mcp();
  const listing = await client.listTools(); assert.equal(listing.tools.length, 9);
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    assert.deepEqual(response.structuredContent, JSON.parse(response.content[0].text));
    return response.structuredContent;
  };
  const manifest = await call('launchlab_service_info');
  assert.equal(manifest.integration.registration, 'pending');
  assert.equal(manifest.billing.workflowPayments, 'not_connected');
  const first = await call('launchlab_submit_project', { repoUrl, requestKey: brief.requestKey });
  const workflowId = first.workflowId;
  assert.equal(first.state, 'working'); assert.equal(first.deploymentVerified, false);
  assert.equal(first.nextAction.tool, 'launchlab_check_progress');
  assert.equal((await call('launchlab_get_results', { workflowId })).results.state, 'not_ready');
  assert.equal((await f.work()).status, 'completed');
  const questions = await call('launchlab_check_progress', { workflowId });
  assert.equal(questions.state, 'needs_input'); assert.equal(questions.deploymentVerified, false);
  assert.deepEqual(questions.workflow.questions.map((q) => q.id), ['hypothesis', 'audience']);
  assert.equal(f.client.calls.length, 0);
  const input = { workflowId, requestKey: 'answer-provider-001', expectedRevision: questions.workflow.revision,
    answers: { hypothesis: brief.hypothesis, audience: brief.audience } };
  const accepted = await call('launchlab_answer_questions', input);
  assert.equal((await call('launchlab_answer_questions', input)).receipt.id, accepted.receipt.id);
  await f.work();
  const plan = await call('launchlab_check_progress', { workflowId });
  assert.equal(plan.state, 'awaiting_approval'); assert.equal(plan.nextAction.requiresUserApproval, true);
  assert.equal(plan.workflow.source.commitSha, commit); assert.ok(plan.workflow.plan.patches.length);
  assert.equal(f.client.calls.length, 1); assert.equal(f.starts.length, 0);
  // An old submit receipt must not resurrect its obsolete questions.
  assert.equal((await call('launchlab_submit_project', { repoUrl, requestKey: brief.requestKey })).state, 'awaiting_approval');
  const approval = { ...plan.nextAction.input, authorization: 'approved_by_user' };
  assert.equal((await f.request('approve', plan.nextAction.input)).status, 400);
  const approvals = await Promise.all([f.request('approve', approval), f.request('approve', approval)]);
  assert.ok(approvals.every((r) => r.status === 202));
  assert.equal(approvals[0].value.receipt.id, approvals[1].value.receipt.id);
  assert.equal(approvals[0].value.deploymentVerified, false);
  await f.work();
  const delivery = await call('launchlab_check_progress', { workflowId });
  assert.equal(delivery.state, 'ready'); assert.equal(delivery.deploymentVerified, true);
  assert.equal(delivery.workflow.delivery.website, 'https://preview.example.test');
  assert.equal((await f.request('approve', approval)).status, 200);
  assert.equal(f.starts.length, 1);
  const report = await call('launchlab_get_results', { workflowId, cohort: 'test', days: '7' });
  assert.equal(report.results.report.sessions, 1); assert.equal(report.results.cohort, 'test');
  assert.equal((await call('launchlab_get_results', { workflowId })).results.report.sessions, 0);
  assert.equal(f.client.calls.length, 1);
  for (const secret of ['fixture-preview-password', 'fixture-report-secret', 'credentialsPath']) assert.ok(!JSON.stringify({ delivery, report, plan }).includes(secret));
  const access = await call('launchlab_get_preview_access', { workflowId });
  assert.equal(access.sensitive, true); assert.equal(access.access.password, 'fixture-preview-password');
  assert.ok(!JSON.stringify(access).includes('fixture-report-secret'));
  const analyze = { workflowId, cohort: 'test', days: '7', requestKey: 'analyze-provider-001' };
  await call('launchlab_analyze_results', analyze); await f.work();
  const analysis = await call('launchlab_check_progress', { workflowId });
  assert.equal(analysis.operation.action, 'analyze'); assert.ok(analysis.analysis);
  assert.equal(f.starts.length, 1); assert.equal(f.client.calls.length, 2);
  await call('launchlab_analyze_results', analyze);
  assert.equal(f.store.claim(), null); assert.equal(f.client.calls.length, 2);
});

test('provider HTTP and MCP enforce caller isolation, revocation, strict schemas and no browser access', async (t) => {
  const f = await setup(t);
  assert.equal((await f.request('submit', brief, null)).status, 401);
  const first = await f.request('submit', { repoUrl, requestKey: brief.requestKey });
  const workflowId = first.value.workflowId;
  const second = await f.request('submit', { repoUrl, requestKey: brief.requestKey }, f.kb);
  assert.notEqual(second.value.workflowId, workflowId);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal((await f.request('submit', { ...brief, audience: 'changed' })).status, 409);
  assert.equal((await f.request('submit', { ...brief, apiKey: 'must-not-be-accepted' })).status, 400);
  assert.equal((await f.request('submit', { ...brief, repoUrl: 'http://127.0.0.1/private' })).status, 400);
  assert.equal((await f.request('unknown', {})).status, 400);
  const inputs = {
    status: { workflowId }, results: { workflowId }, access: { workflowId },
    answer: { workflowId, requestKey: 'answer-cross-001', expectedRevision: 1, answers: { audience: 'Nobody' } },
    approve: { workflowId, expectedRevision: 1, planDigest: 'a'.repeat(64), authorization: 'approved_by_user' },
    analyze: { workflowId, requestKey: 'analysis-cross-001' },
    resume: { workflowId, requestKey: 'resume-cross-001', expectedRevision: 1 },
  };
  for (const [action, input] of Object.entries(inputs)) assert.equal((await f.request(action, input, f.kb)).status, 404, action);
  const client = await f.mcp(f.kb);
  const denied = await client.callTool({ name: 'launchlab_check_progress', arguments: { workflowId } });
  assert.equal(denied.isError, true); assert.equal(denied.structuredContent.status, 404);
  const headers = { Authorization: 'Bearer ' + f.ka.token };
  assert.equal((await fetch(f.origin + '/api/okx/service')).status, 401);
  assert.equal((await fetch(f.origin + '/api/okx/service', { headers: { ...headers, Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await fetch(f.origin + '/api/okx/mcp', { headers })).status, 405);
  assert.equal((await fetch(f.origin + '/api/okx/invoke', { method: 'POST', headers, body: '{}' })).status, 415);
  assert.equal((await fetch(f.origin + '/api/okx/invoke', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit', input: { filler: 'x'.repeat(17000) } }) })).status, 413);
  f.store.revokeKey(f.kb.id);
  assert.equal((await f.request('status', { workflowId: second.value.workflowId }, f.kb)).status, 401);
  await assert.rejects(client.callTool({ name: 'launchlab_service_info', arguments: {} }));
  assert.equal(f.client.calls.length, 0); assert.equal(f.starts.length, 0);
});

test('stale approvals fail without deployment and uncertain operations surface recovery without repeating GPT', async (t) => {
  const f = await setup(t);
  const first = await f.request('submit', brief), workflowId = first.value.workflowId;
  await f.work();
  const plan = (await f.request('status', { workflowId })).value;
  await f.request('answer', { workflowId, expectedRevision: 1, requestKey: 'revision-provider-001', answers: { audience: 'New gym-goers' } });
  assert.equal((await f.request('status', { workflowId })).value.nextAction.action, 'status');
  await f.work();
  await f.request('approve', { ...plan.nextAction.input, authorization: 'approved_by_user' });
  assert.equal((await f.work()).status, 'failed');
  const failed = (await f.request('status', { workflowId })).value;
  assert.equal(failed.state, 'needs_attention'); assert.match(failed.summary, /Approval does not match/);
  assert.equal(failed.nextAction.action, 'review_operation');
  assert.equal(f.starts.length, 0);
  const current = failed.nextAction.workflowNextAction;
  await f.request('approve', { ...current.input, authorization: 'approved_by_user' });
  await f.work();
  await f.request('analyze', { workflowId, requestKey: 'lost-analysis-001' });
  f.store.claim(); f.store.recover(); await f.work();
  const recovered = (await f.request('status', { workflowId })).value;
  assert.equal(recovered.state, 'needs_attention'); assert.equal(recovered.deploymentVerified, true);
  assert.equal(recovered.operation.state, 'needs_recovery');
  assert.equal(recovered.analysis, null); assert.equal(f.client.calls.length, 2);
  await f.request('status', { workflowId }); await f.request('results', { workflowId });
  assert.equal(f.client.calls.length, 2); assert.equal(f.starts.length, 1);
});

test('completed inspection of an unsupported runtime is blocked, never delivered', async (t) => {
  const f = await setup(t, { unsupported: true });
  const first = await f.request('submit', brief); await f.work();
  const status = (await f.request('status', { workflowId: first.value.workflowId })).value;
  assert.equal(status.operation.state, 'completed'); assert.equal(status.state, 'blocked');
  assert.equal(status.deploymentVerified, false); assert.equal(status.nextAction.action, 'resolve_blocker');
  assert.equal(f.client.calls.length, 0); assert.equal(f.starts.length, 0);
});
