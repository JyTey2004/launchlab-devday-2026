import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

// A real MCP client, not an LLM simulation. Makes the same tool calls a reasoning agent can make.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))],
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'launchlab-demo-client', version: '0.1.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`Connected: ${tools.tools.length} MCP tools`);
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const plan = await call('launchlab_plan_run', {
    requestKey: process.env.LAUNCHLAB_DEMO_REQUEST_KEY || 'launchlab-agent-demo-v1',
    title: 'Agent-created first-user experiment',
    goal: 'Learn whether a new builder understands the result of preparing a service request.',
    audience: 'Builders exploring X Layer and agent services',
    task: 'Choose a service, prepare a request and report any confusing step or blocker.',
    participants: 5,
    budget: 50,
  });
  console.log(`Run: ${plan.id} · source ${plan.plan.source.digest.slice(0, 12)}`);
  console.log(
    `Scope: ${plan.plan.participants} accepted submissions; ${plan.plan.costs.rewardPool} demo credits (no cash value)`,
  );
  // Running this demo authorizes this fixed, local-only example. A general client must
  // present its returned plan or match it to the user's existing authorization first.
  const run = await call('launchlab_start_run', { runId: plan.id, planDigest: plan.planDigest });
  console.log(`Status: ${run.status}`);
  if (run.status === 'blocked') throw new Error(run.blocker.message);
  const origin = process.env.LAUNCHLAB_URL || 'http://127.0.0.1:4310';
  console.log(`Progress: ${origin}${run.links.status}`);
  if (run.links.preview) console.log(`Verified preview: ${run.links.preview}`);
  if (run.links.experiment) console.log(`Try it: ${origin}${run.links.experiment}`);
  console.log(run.nextAction);
  console.log(
    'No human participation, real rewards or OKX order was created by this demonstration.',
  );
} finally {
  await client.close();
}
