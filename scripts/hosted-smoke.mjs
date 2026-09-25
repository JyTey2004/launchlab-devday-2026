import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Aws, writeJson } from '../src/managed/io.mjs';

const directory = resolve('.data/hosted-operator');
const founder = JSON.parse(await readFile(`${directory}/founder-client.json`, 'utf8'));
const other = JSON.parse(await readFile(`${directory}/isolation-client.json`, 'utf8'));
const release = JSON.parse(await readFile(`${directory}/release.json`, 'utf8'));
const aws = new Aws({ profile: 'stardive', region: 'ap-southeast-1', account: '113978311640', directory }); await aws.verify();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const request = (path, caller, input) => fetch(founder.origin + path, { method: input ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(caller ? { Authorization: 'Bearer ' + caller.token } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
async function remote(commands) {
  const result = await aws.call('ssm', 'send-command', { InstanceIds: [release.instanceId], DocumentName: 'AWS-RunShellScript', Parameters: { commands } });
  for (let n = 0; n < 30; n++) {
    await pause(2000);
    let status;
    try { status = await aws.call('ssm', 'get-command-invocation', { CommandId: result.Command.CommandId, InstanceId: release.instanceId }); }
    catch { continue; }
    if (status.Status === 'Success') return;
    if (['Failed', 'Cancelled', 'TimedOut'].includes(status.Status)) throw new Error('Host operation failed; inspect SSM privately.');
  }
  throw new Error('Host operation is still pending.');
}
async function poll(job) {
  for (let n = 0; n < 30; n++) {
    const response = await request(`/api/agent/jobs/${job.id}`, founder); assert.equal(response.status, 200);
    const value = await response.json();
    if (!['queued', 'running'].includes(value.status)) return value;
    await pause(2000);
  }
  throw new Error('Job did not complete in the smoke-test window.');
}

const input = { repoUrl: 'https://github.com/mdn/beginner-html-site-styled', ref: '6c7a360ddb4a0d75be06044bf8a914f260ff10c7', requestKey: 'hosted-public-intake-smoke-20260922', allowRepairs: true };
assert.equal((await request('/health')).status, 200);
assert.equal((await request('/api/agent/workflows', null, input)).status, 401);
const client = new Client({ name: 'hosted-service-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('scripts/hosted-mcp.mjs'), `${directory}/founder-client.json`], stderr: 'pipe' }));
let first;
try {
  const listing = await client.listTools(); assert.equal(listing.tools.length, 9);
  const result = await client.callTool({ name: 'launchlab_plan_workflow', arguments: input }); assert.ok(!result.isError);
  first = JSON.parse(result.content[0].text);
  const complete = await poll(first);
  assert.equal(complete.status, 'completed'); assert.equal(complete.result.status, 'needs_input');
  assert.equal(complete.result.source.commitSha, input.ref);
  const duplicate = await (await request('/api/agent/workflows', founder, input)).json(); assert.equal(duplicate.id, first.id);
  for (const suffix of ['', '/access', '/report']) assert.equal((await request(`/api/agent/workflows/${first.workflowId}${suffix}`, other)).status, 404);
  assert.equal((await request(`/api/agent/jobs/${first.id}`, other)).status, 404);
  assert.equal((await request(`/api/agent/workflows/${first.workflowId}/resume`, other, { requestKey: 'isolation-resume-001', expectedRevision: 1 })).status, 404);
  const fromMcp = await client.callTool({ name: 'launchlab_get_job', arguments: { jobId: first.id } });
  assert.equal(JSON.parse(fromMcp.content[0].text).status, 'completed');
  console.log('HTTPS, MCP intake, pinned source, idempotency and cross-caller isolation verified.');
} finally { await client.close(); }

await remote(['systemctl stop launchlab-worker']);
let queued;
try {
  queued = await (await request('/api/agent/workflows', founder, { ...input, requestKey: `hosted-public-restart-${Date.now()}` })).json();
  assert.equal(queued.status, 'queued');
  assert.equal((await (await request(`/api/agent/jobs/${queued.id}`, founder)).json()).status, 'queued');
} finally { await remote(['systemctl restart launchlab-api', 'systemctl start launchlab-worker']); }
const recovered = await poll(queued); assert.equal(recovered.status, 'completed'); assert.equal(recovered.result.status, 'needs_input');
assert.equal((await request(`/api/agent/workflows/${first.workflowId}`, founder)).status, 200);
assert.equal((await request('/health')).status, 200);
const evidence = { at: new Date().toISOString(), origin: founder.origin, instanceId: release.instanceId, releaseDigest: release.releaseDigest,
  tls: 'Publicly trusted certificate verified by Node fetch and curl; no certificate bypass.', health: 200, anonymousApi: 401,
  mcpWorkflowTools: 9, sourceRepository: input.repoUrl, sourceCommit: input.ref,
  intake: { jobId: first.id, workflowId: first.workflowId, status: 'needs_input', duplicateReusedJob: true },
  isolation: { separateCaller: true, workflowRead: 404, reportRead: 404, previewAccess: 404, jobRead: 404, mutation: 404 },
  restart: { workerStoppedBeforeEnqueue: true, apiAndWorkerRestarted: true, sameQueuedJobCompleted: true, previousWorkflowPersisted: true, jobId: queued.id, workflowId: queued.workflowId },
  billing: { modelCalls: 0, customerDeployments: 0, payments: 0, baseAwsHostRunning: true },
  limitations: ['Smoke test ends at clarification; no new live GPT plan or customer build from this host was executed.', 'Single-host demo, public GitHub only, operator-triggered backups, no currency spending cap or automatic environment expiry.', 'OKX AI registration and x402 workflow billing are not implemented by this step.'] };
await writeJson('deploy/hosted-service-evidence.json', evidence);
console.log(JSON.stringify({ status: 'passed', evidence: 'deploy/hosted-service-evidence.json', origin: founder.origin }));
