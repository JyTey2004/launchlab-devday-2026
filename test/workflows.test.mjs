import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentWorkflows } from '../src/agent/workflows.mjs';
import { writeJson } from '../src/managed/io.mjs';
import { apiServer, listen } from '../src/http.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { fixture, repoUrl, commit, brief } from './helpers/workflow-fixture.mjs';

const approve = (workflow) => ({ expectedRevision: workflow.revision, planDigest: workflow.plan.digest });

test('repo-only intake asks structured questions without GPT, answers pin the source and retries reuse one plan', async (t) => {
  const f = await fixture(t, { multiRoot: true });
  const first = await f.workflows.create({ requestKey: brief.requestKey, repoUrl });
  assert.equal(first.status, 'needs_input');
  assert.deepEqual(first.questions.map((q) => q.id), ['hypothesis', 'audience', 'rootDirectory']);
  assert.equal(first.source.commitSha, commit); assert.equal(f.client.calls.length, 0);
  const answer = { requestKey: 'answer-first-001', expectedRevision: 1, answers: { hypothesis: brief.hypothesis, audience: brief.audience, rootDirectory: 'apps/store' } };
  await assert.rejects(f.workflows.answer(first.id, { ...answer, answers: { ...answer.answers, rootDirectory: 'apps/unknown' } }), /inspected application/);
  const plan = await f.workflows.answer(first.id, answer);
  assert.equal(plan.id, first.id); assert.equal(plan.revision, 2); assert.equal(plan.status, 'awaiting_approval');
  assert.equal(plan.plan.patches.length, 1); assert.equal(plan.plan.scope.sourceChanges.includes('Original GitHub'), true);
  assert.ok(f.inspections.slice(1).every((i) => i.ref === commit));
  assert.equal((await f.workflows.answer(first.id, answer)).plan.digest, plan.plan.digest);
  assert.equal((await f.workflows.create({ requestKey: brief.requestKey, repoUrl })).revision, 2);
  assert.equal(f.client.calls.length, 1); assert.equal(f.starts.length, 0);
  await assert.rejects(f.workflows.answer(first.id, { ...answer, answers: { ...answer.answers, audience: 'Different audience' } }), /different input/);
  await assert.rejects(f.workflows.create({ ...brief, audience: 'Changed initial request' }), /different workflow/);
});

test('a revised brief invalidates old approval; repeated and concurrent starts dispatch once', async (t) => {
  const f = await fixture(t), first = await f.workflows.create(brief);
  const revised = await f.workflows.answer(first.id, { requestKey: 'answer-revise-001', expectedRevision: first.revision, answers: { audience: 'First-time gym-goers' } });
  assert.notEqual(revised.plan.digest, first.plan.digest);
  await assert.rejects(f.workflows.start(first.id, approve(first)), /current revision/);
  const results = await Promise.allSettled([f.workflows.start(first.id, approve(revised)), f.workflows.start(first.id, approve(revised))]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal(f.starts.length, 1);
  assert.equal((await f.workflows.start(first.id, approve(revised))).status, 'ready');
  assert.equal(f.starts.length, 1);
  await assert.rejects(f.workflows.answer(first.id, { requestKey: 'answer-after-001', expectedRevision: revised.revision, answers: { audience: 'Someone else' } }), /already been authorized/);
  const state = JSON.stringify(await f.workflows.get(first.id));
  assert.ok(!state.includes('fixture-preview-password')); assert.ok(!state.includes('fixture-report-secret')); assert.ok(!state.includes('credentialsPath'));
});

test('unsupported adapters stay blocked despite clarification; client inputs cannot carry secrets or replace source', async (t) => {
  const f = await fixture(t, { unsupported: true });
  const first = await f.workflows.create(brief);
  assert.equal(first.status, 'blocked'); assert.equal(first.blockers[0].code, 'framework');
  assert.equal(first.nextAction.type, 'resolve_blocker');
  assert.equal(first.plan, null); assert.equal(f.client.calls.length, 0);
  const next = await f.workflows.answer(first.id, { requestKey: 'answer-repairs-001', expectedRevision: 1, answers: { allowRepairs: true } });
  assert.equal(next.status, 'blocked'); assert.equal(f.client.calls.length, 0);
  for (const answers of [{ apiKey: 'must-not-be-accepted' }, { repoUrl: 'https://github.com/other/repo' }, { rootDirectory: '../other' }]) {
    await assert.rejects(f.workflows.answer(first.id, { requestKey: 'answer-invalid-001', expectedRevision: next.revision, answers }));
  }
  await assert.rejects(f.workflows.create({ ...brief, repoUrl: 'http://127.0.0.1/private' }));
});

test('restart recovers a saved completed plan without another GPT request', async (t) => {
  const f = await fixture(t), plan = await f.workflows.create(brief);
  const record = await f.workflows.load(plan.id);
  record.status = 'planning'; delete record.planDigest; delete record.deploymentId;
  await f.workflows.save(record);
  const restarted = new AgentWorkflows({ agent: f.agent });
  assert.equal((await restarted.get(plan.id)).status, 'needs_recovery');
  const recovered = await restarted.resume(plan.id, { requestKey: 'resume-saved-001', expectedRevision: plan.revision });
  assert.equal(recovered.plan.digest, plan.plan.digest); assert.equal(recovered.status, 'awaiting_approval');
  assert.equal(f.client.calls.length, 1); assert.equal(f.starts.length, 0);
});

test('prototype-named mutation keys remain ordinary persisted idempotency keys', async (t) => {
  const f = await fixture(t), first = await f.workflows.create({ requestKey: brief.requestKey, repoUrl });
  const input = { requestKey: '__proto__', expectedRevision: 1, answers: { hypothesis: brief.hypothesis, audience: brief.audience } };
  const plan = await f.workflows.answer(first.id, input);
  const restarted = new AgentWorkflows({ agent: f.agent });
  assert.equal((await restarted.answer(first.id, input)).plan.digest, plan.plan.digest);
  assert.equal(f.client.calls.length, 1);
});

test('uncertain model calls need an explicit new attempt; retrying that mutation never bills again', async (t) => {
  const f = await fixture(t), generate = f.client.generate.bind(f.client);
  f.client.generate = async () => { f.client.calls.push('lost-model-response'); throw new Error('Fixture response lost.'); };
  const blocked = await f.workflows.create(brief);
  assert.equal(blocked.status, 'blocked'); assert.equal(f.client.calls.length, 1);
  await assert.rejects(f.workflows.resume(blocked.id, { requestKey: 'resume-model-001', expectedRevision: 1 }), /may already have been billed/);
  assert.equal(f.client.calls.length, 1);
  f.client.generate = generate;
  const input = { requestKey: 'resume-model-002', expectedRevision: 1, retryPlanning: true };
  const recovered = await f.workflows.resume(blocked.id, input);
  assert.equal(recovered.revision, 2); assert.equal(recovered.status, 'awaiting_approval');
  assert.equal((await f.workflows.resume(blocked.id, input)).revision, 2);
  assert.equal(f.client.calls.length, 2);
});

test('recovery never removes a live or unknown planning lock; known-dead workflow owners can be recovered', async (t) => {
  const f = await fixture(t), plan = await f.workflows.create(brief);
  const record = await f.workflows.load(plan.id);
  record.status = 'planning'; delete record.planDigest; delete record.deploymentId;
  await f.workflows.save(record);
  const lock = join(f.workflows.folder(plan.id), 'operation.lock');
  await writeJson(lock, { pid: process.pid });
  await assert.rejects(f.workflows.resume(plan.id, { requestKey: 'resume-active-001', expectedRevision: 1 }), /still running/);
  const deadPid = 987654;
  await writeJson(lock, { pid: deadPid });
  const restarted = new AgentWorkflows({ agent: f.agent, ownerAlive: (pid) => pid !== deadPid });
  assert.equal((await restarted.resume(plan.id, { requestKey: 'resume-dead-001', expectedRevision: 1 })).status, 'awaiting_approval');
  assert.equal(f.client.calls.length, 1);
  const attempt = await f.agent.get(plan.experimentId); attempt.status = 'designing'; delete attempt.planDigest; delete attempt.deploymentId; await f.agent.save(attempt);
  record.status = 'blocked'; await f.workflows.save(record);
  await writeFile(join(f.agent.folder(plan.experimentId), 'planning.lock'), '');
  await assert.rejects(restarted.resume(plan.id, { requestKey: 'resume-unknown-001', expectedRevision: 1, retryPlanning: true }), /operator inspection/);
  assert.equal(f.client.calls.length, 1);
});

test('uncertain dispatch resumes the same approved deployment and does not create another plan', async (t) => {
  const f = await fixture(t), plan = await f.workflows.create(brief);
  f.pipeline.start = async (id, input) => { f.starts.push(id); await f.pipeline.authorize(id, input); throw new Error('Fixture worker handoff failed.'); };
  await f.workflows.start(plan.id, approve(plan));
  await f.workflows.start(plan.id, approve(plan));
  assert.equal(f.starts.length, 1);
  f.pipeline.start = async (id, input) => { f.starts.push(id); await f.pipeline.authorize(id, input); return f.complete(id); };
  const input = { requestKey: 'resume-worker-001', expectedRevision: 1 };
  assert.equal((await f.workflows.resume(plan.id, input)).status, 'ready');
  await f.workflows.resume(plan.id, input);
  assert.deepEqual(f.starts, [plan.deploymentId, plan.deploymentId]);
  assert.equal(f.client.calls.length, 1); assert.equal((await f.pipeline.list()).length, 1);
  await assert.rejects(f.workflows.resume(plan.id, { requestKey: 'resume-replan-001', expectedRevision: 1, retryPlanning: true }), /cannot be replanned/);
});

test('a known-dead model attempt can be retried explicitly while preserving its old evidence', async (t) => {
  const f = await fixture(t), plan = await f.workflows.create(brief);
  const record = await f.workflows.load(plan.id), experiment = await f.agent.get(plan.experimentId);
  record.status = 'planning'; delete record.planDigest; delete record.deploymentId;
  experiment.status = 'designing'; delete experiment.planDigest; delete experiment.deploymentId;
  await f.workflows.save(record); await f.agent.save(experiment);
  const deadPid = 987654;
  await writeJson(join(f.agent.folder(plan.experimentId), 'planning.lock'), { pid: deadPid });
  const restarted = new AgentWorkflows({ agent: f.agent, ownerAlive: (pid) => pid !== deadPid });
  await assert.rejects(restarted.resume(plan.id, { requestKey: 'resume-dead-model-001', expectedRevision: 1 }), /may already have been billed/);
  const recovered = await restarted.resume(plan.id, { requestKey: 'resume-dead-model-002', expectedRevision: 1, retryPlanning: true });
  assert.equal(recovered.status, 'awaiting_approval'); assert.equal(recovered.revision, 2);
  assert.notEqual(recovered.experimentId, plan.experimentId);
  assert.equal((await f.agent.get(plan.experimentId)).status, 'designing');
  assert.equal(f.client.calls.length, 2);
});

test('a plan for another source cannot become an approvable workflow', async (t) => {
  const f = await fixture(t), plan = f.agent.plan.bind(f.agent);
  f.agent.plan = async (input) => {
    const experiment = await plan(input);
    return { ...experiment, source: { ...experiment.source, commitSha: 'b'.repeat(40) } };
  };
  const blocked = await f.workflows.create(brief);
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.plan, null);
  assert.match(blocked.blockers[0].message, /pinned source/);
  assert.equal(f.starts.length, 0);
});

test('report and analysis validate project, revision and cohort before exposing or summarizing evidence', async (t) => {
  const f = await fixture(t), plan = await f.workflows.create(brief);
  assert.equal((await f.workflows.report(plan.id)).status, 'not_ready');
  assert.equal(f.reports.length, 0);
  await f.workflows.start(plan.id, approve(plan));
  const read = f.pipeline.report.bind(f.pipeline);
  for (const change of [{ project: 'other-project' }, { experimentId: 'other-experiment' }, { sourceCommit: 'b'.repeat(40) }, { cohort: 'test' }, { days: 30 }]) {
    f.pipeline.report = async (...args) => ({ ...await read(...args), ...change });
    await assert.rejects(f.workflows.report(plan.id), /does not match/);
    await assert.rejects(f.workflows.analyze(plan.id), /does not match/);
  }
  assert.equal(f.client.calls.length, 1);
  f.pipeline.report = read;
  assert.equal((await f.workflows.analyze(plan.id)).analysis.status, 'no_evidence');
  assert.equal(f.client.calls.length, 1);
  const testAnalysis = await f.workflows.analyze(plan.id, { cohort: 'test' });
  assert.equal(testAnalysis.analysis.analysisScope, 'instrumentation-only');
  assert.deepEqual(testAnalysis.analysis.suggestions, []);
  assert.equal((await f.workflows.analyze(plan.id, { cohort: 'test' })).analysis.cached, true);
  assert.equal(f.client.calls.length, 2);
});

test('an external MCP client completes intake, clarification, approval, delivery, access and results without the dashboard', async (t) => {
  const f = await fixture(t, { multiRoot: true });
  const server = apiServer({}, {}, 'workflow-fixture-token', f.pipeline, f.agent);
  const port = await listen(server, 0), origin = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const denied = await fetch(origin + '/api/agent/workflows', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
  assert.equal(denied.status, 403); assert.equal(f.inspections.length, 0);
  const client = new Client({ name: 'workflow-e2e-fixture', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.mjs'], env: { ...process.env, LAUNCHLAB_URL: origin, LAUNCHLAB_API_TOKEN: 'workflow-fixture-token' }, stderr: 'pipe' }));
  t.after(() => client.close());
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text);
  }
  const first = await call('launchlab_plan_workflow', { requestKey: brief.requestKey, repoUrl });
  assert.equal(first.nextAction.tool, 'launchlab_answer_workflow');
  const plan = await call('launchlab_answer_workflow', { workflowId: first.id, requestKey: 'mcp-answer-001', expectedRevision: 1, answers: { hypothesis: brief.hypothesis, audience: brief.audience, rootDirectory: 'apps/store' } });
  const got = await call('launchlab_get_workflow', { workflowId: first.id });
  assert.equal(got.nextAction.tool, 'launchlab_start_workflow'); assert.equal(got.plan.digest, plan.plan.digest);
  assert.equal((await call('launchlab_workflow_report', { workflowId: first.id })).status, 'not_ready');
  const ready = await call('launchlab_start_workflow', { workflowId: first.id, ...approve(plan) });
  assert.equal(ready.status, 'ready'); assert.equal(ready.delivery.website, 'https://preview.example.test');
  assert.ok(!JSON.stringify(ready).includes('fixture-preview-password'));
  assert.equal((await fetch(origin + ready.links.access)).status, 403);
  const access = await call('launchlab_workflow_access', { workflowId: first.id });
  assert.equal(access.password, 'fixture-preview-password'); assert.ok(!JSON.stringify(access).includes('fixture-report-secret'));
  assert.equal((await call('launchlab_workflow_report', { workflowId: first.id, cohort: 'test', days: '30' })).report.sessions, 1);
  assert.equal((await call('launchlab_analyze_workflow', { workflowId: first.id })).analysis.status, 'no_evidence');
  assert.equal((await call('launchlab_resume_workflow', { workflowId: first.id, requestKey: 'mcp-resume-001', expectedRevision: plan.revision })).status, 'ready');
  assert.equal(f.starts.length, 1); assert.equal(f.client.calls.length, 1);
});
