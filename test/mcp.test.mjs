import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';

test('MCP repository inspection returns evidence and an advisory recipe without creating a run', async (t) => {
  const f = await fixture(t);
  const sha = 'd'.repeat(40);
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'api.github.com') return realFetch(url, options);
    if (parsed.pathname.includes('/commits/'))
      return Response.json({ sha, commit: { tree: { sha: 'e'.repeat(40) } } });
    const pkg = JSON.stringify({ dependencies: { next: '16' }, scripts: { build: 'next build' } });
    if (parsed.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: false,
        tree: ['package.json', 'package-lock.json'].map((path) => ({
          path,
          type: 'blob',
          mode: '100644',
          size: pkg.length,
        })),
      });
    assert.equal(parsed.searchParams.get('ref'), sha);
    return Response.json({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(pkg).toString('base64'),
    });
  });
  const client = new Client({ name: 'inspection-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))],
      env: { ...process.env, LAUNCHLAB_URL: f.origin, LAUNCHLAB_API_TOKEN: 'test-token-for-agent' },
      stderr: 'pipe',
    }),
  );
  const response = await client.callTool({
    name: 'launchlab_inspect_deployment',
    arguments: { repoUrl: 'https://github.com/example/project' },
  });
  assert.ok(!response.isError);
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.detected.framework, 'nextjs');
  assert.equal(result.deploymentPlan.source.commitSha, sha);
  assert.equal(result.deploymentPlan.build.command, 'npm run build');
  assert.equal(result.deploymentPlan.canDeploy, false);
  assert.ok(result.evidence.length > 0);
  assert.equal(f.store.read().projects.length, 0);
  assert.equal(f.store.read().runs.length, 0);
});

test('official MCP client can discover tools and complete an agent launch flow', async (t) => {
  const f = await fixture(t);
  const client = new Client({ name: 'launchlab-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))],
    env: { ...process.env, LAUNCHLAB_URL: f.origin, LAUNCHLAB_API_TOKEN: 'test-token-for-agent' },
    stderr: 'pipe',
  });
  await client.connect(transport);
  t.after(() => client.close());
  const listing = await client.listTools();
  assert.equal(listing.tools.length, 30);
  assert.equal(
    listing.tools.find((tool) => tool.name === 'launchlab_inspect_deployment').annotations
      .readOnlyHint,
    true,
  );
  async function call(name, args) {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  }
  const project = await call('launchlab_import', {});
  const release = await call('launchlab_deploy', { projectId: project.id });
  assert.equal(release.status, 'ready');
  const campaign = await call('launchlab_open_campaign', {
    releaseId: release.id,
    title: 'MCP-created experiment',
    audience: 'Agent builders',
    task: 'Try the preview and describe the first confusing step.',
    budget: 25,
    reward: 5,
  });
  const report = await call('launchlab_report', { campaignId: campaign.id });
  assert.equal(report.campaign.pool.available, 25);
  assert.equal(report.summary.submissions, 0);
  const error = await client.callTool({
    name: 'launchlab_deploy',
    arguments: { projectId: 'does-not-exist' },
  });
  assert.equal(error.isError, true);
  const unsafeInspection = await client.callTool({
    name: 'launchlab_inspect_deployment',
    arguments: { repoUrl: 'https://example.com/private' },
  });
  assert.equal(unsafeInspection.isError, true);
  const plan = await call('launchlab_plan_run', {
    requestKey: 'mcp-run-example',
    title: 'MCP planned experiment',
    goal: 'Can a first-time developer understand the prepared request?',
    audience: 'First-time agent builders',
    task: 'Prepare a service request and describe what you expected to happen next.',
    participants: 2,
    budget: 20,
  });
  assert.equal(plan.status, 'planned');
  const run = await call('launchlab_start_run', { runId: plan.id, planDigest: plan.planDigest });
  assert.equal(run.status, 'collecting');
  const polled = await call('launchlab_get_run', { runId: plan.id });
  assert.equal(polled.report.campaign.id, run.report.campaign.id);
  const closed = await call('launchlab_close_run', { runId: plan.id });
  assert.equal(closed.status, 'closed');
});
