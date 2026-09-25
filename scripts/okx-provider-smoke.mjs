import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { hash } from '../src/managed/contracts.mjs';

const [file, workflowId, ...flags] = process.argv.slice(2);
if (!file || !/^wf_[a-f0-9]{20}$/.test(workflowId || '')) throw new Error('Usage: node scripts/okx-provider-smoke.mjs PRIVATE_CLIENT_FILE WORKFLOW_ID [--intake] [--output FILE]');
const config = JSON.parse(await readFile(file, 'utf8')), origin = new URL(config.origin);
if (origin.protocol !== 'https:' || origin.origin + '/' !== origin.href || !/^ll_[A-Za-z0-9_-]{43}$/.test(config.token)) throw new Error('Invalid private client configuration.');
const headers = { Authorization: 'Bearer ' + config.token };
const fetchBounded = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
async function read(path) {
  const response = await fetchBounded(origin.origin + path, { headers });
  assert.equal(response.status, 200, 'Authenticated read failed.');
  return response.json();
}
const client = new Client({ name: 'launchlab-provider-smoke', version: '1.0.0' });
const evidence = { at: new Date().toISOString(), origin: origin.origin, workflowId, checks: {}, cohorts: {} };
try {
  assert.equal((await fetchBounded(origin.origin + '/health')).status, 200);
  assert.equal((await fetchBounded(origin.origin + '/api/okx/service')).status, 401);
  evidence.checks.health = 200; evidence.checks.anonymousDenied = 401;
  const manifest = await read('/api/okx/service');
  assert.equal(manifest.protocol, 'launchlab.provider.v1');
  assert.equal(manifest.integration.registration, 'pending');
  assert.equal(manifest.billing.workflowPayments, 'not_connected');
  await client.connect(new StreamableHTTPClientTransport(new URL('/api/okx/mcp', origin), { requestInit: { headers }, fetch: fetchBounded }));
  const tools = await client.listTools(); assert.equal(tools.tools.length, 9);
  evidence.checks.remoteMcpTools = tools.tools.map((tool) => tool.name);
  async function call(name, input = {}) {
    const result = await client.callTool({ name, arguments: input });
    assert.ok(!result.isError, 'Remote tool reported an error.');
    assert.ok(result.structuredContent, 'Missing structured result.');
    assert.ok(!JSON.stringify(result).includes(config.token), 'Credential leaked in result.');
    return result.structuredContent;
  }
  assert.equal((await call('launchlab_service_info')).protocol, manifest.protocol);
  const status = await call('launchlab_check_progress', { workflowId });
  assert.equal(status.deploymentVerified, true, 'Choose an existing verified workflow.');
  const original = await read(`/api/agent/workflows/${workflowId}`);
  assert.equal(status.workflow.delivery.website, original.delivery.website);
  assert.equal(status.workflow.source.commitSha, original.source.commitSha);
  evidence.checks.existingDeliveryMatches = true;
  evidence.website = status.workflow.delivery.website;
  const fields = ['project', 'experimentId', 'sourceCommit', 'cohort', 'days', 'sessions', 'primaryActions', 'primaryActionOccurrences', 'primaryActionLegacySessions', 'responses', 'eventCounts', 'comments'];
  const measured = (report) => Object.fromEntries(fields.map((key) => [key, report[key]]));
  for (const cohort of ['organic', 'incentivized', 'agent', 'test']) {
    const result = await call('launchlab_get_results', { workflowId, cohort, days: '7' });
    const prior = await read(`/api/agent/workflows/${workflowId}/report?cohort=${cohort}&days=7`);
    assert.equal(hash(measured(result.results.report)), hash(measured(prior.report)), 'Report measurements differ.');
    evidence.cohorts[cohort] = { matchesExistingApi: true, sessions: prior.report.sessions, goalSessions: prior.report.primaryActions,
      recordedGoalActions: prior.report.primaryActionOccurrences, legacyGoalSessions: prior.report.primaryActionLegacySessions, feedbackResponses: prior.report.responses };
  }
  if (flags.includes('--intake')) {
    const input = { requestKey: 'okx-provider-intake-20260924', repoUrl: 'https://github.com/JyTey2004/launchlab-proof-reps-public-demo', ref: '23eeae76ba6839f0b49ebf2b347796bc2b1f7ccc' };
    const first = await call('launchlab_submit_project', input);
    let current = first;
    for (let i = 0; current.state === 'working' && i < 15; i++) {
      await new Promise((done) => setTimeout(done, 2000));
      current = await call('launchlab_check_progress', { workflowId: first.workflowId });
    }
    assert.equal(current.state, 'needs_input');
    assert.equal(current.workflow.source.commitSha, input.ref);
    assert.equal(current.deploymentVerified, false);
    const repeated = await call('launchlab_submit_project', input);
    assert.equal(repeated.receipt.id, first.receipt.id);
    evidence.intake = { workflowId: first.workflowId, jobId: first.receipt.id, sourceCommit: input.ref,
      state: current.state, questionIds: current.workflow.questions.map((q) => q.id), sameReceiptOnRetry: true };
  }
  evidence.scope = { newDeployments: 0, requestedModelCalls: 0, payments: 0, marketplaceRoundTrip: false,
    note: 'Existing deployment and real reports read through the new remote interface; optional new intake ends at questions.' };
  const outputFlag = flags.indexOf('--output');
  if (outputFlag !== -1) {
    if (!flags[outputFlag + 1]) throw new Error('Supply the evidence output path.');
    await writeFile(flags[outputFlag + 1], JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally { await client.close(); }
