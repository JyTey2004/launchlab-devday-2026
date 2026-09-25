import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One explicitly synthetic shopper. A temporary database keeps demo calls out of real studies.
const directory = await mkdtemp(join(tmpdir(), 'launchlab-merch-demo-'));
const client = new Client({ name: 'proof-of-reps-demo-client', version: '0.1.0' });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../examples/proof-of-reps/mcp.mjs', import.meta.url))],
      env: { ...process.env, MERCH_DB: join(directory, 'merch.sqlite'), MERCH_COHORT: 'automated' },
      stderr: 'inherit',
    }),
  );
  async function call(name, input) {
    const result = await client.callTool({ name, arguments: input });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  }
  const session = await call('merch_open', { requestKey: 'synthetic-shopper-1' });
  const recommendations = await call('merch_recommend', {
    sessionId: session.sessionId,
    activity: 'strength',
    size: 'M',
    budgetCents: 4000,
  });
  console.log('Synthetic shopper: gymwear, size M, up to US$40 including demo shipping.');
  console.log('Matches:', recommendations.products.map((product) => product.name).join(', '));
  const quote = await call('merch_quote', {
    sessionId: session.sessionId,
    requestKey: 'tee-quote-1',
    sku: 'proof-tee',
    size: 'M',
    quantity: 1,
    destination: 'SG',
  });
  console.log(
    `Demo quote: US$${(quote.subtotalCents / 100).toFixed(2)} + US$${(quote.shippingEstimateCents / 100).toFixed(2)} fixture shipping. Taxes unconfigured. No payment requested.`,
  );
  const decision = await call('merch_record_intent', {
    sessionId: session.sessionId,
    quoteId: quote.id,
    choice: 'would_buy_card',
    reason: 'payment',
  });
  console.log('Synthetic response: I like the tee, but would prefer to pay by card.');
  console.log('Recorded:', decision.status);
  console.log(JSON.stringify(await call('merch_report', {}), null, 2));
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
