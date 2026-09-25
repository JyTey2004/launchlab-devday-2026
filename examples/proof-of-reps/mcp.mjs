import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { MerchService, inputs } from './service.mjs';

const service = new MerchService(
  process.env.MERCH_DB ||
    fileURLToPath(new URL('../../.data/proof-of-reps.sqlite', import.meta.url)),
  { cohort: process.env.MERCH_COHORT || 'automated' },
);
const server = new McpServer({ name: 'proof-of-reps-demo', version: '0.1.0' });
function tool(name, description, schema, execute, readOnly = false) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(execute(input)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    },
  );
}
tool(
  'merch_open',
  'Open a demo shopping session and read the fictional gymwear catalog. Reuse requestKey on retries. Cohort is assigned by the local operator. Prices are illustrative USD; no real stock or payment.',
  inputs.open.shape,
  (input) => service.open(input),
);
tool(
  'merch_recommend',
  'Find fictional items matching activity, size and a USD budget in cents, including fixture Singapore shipping but excluding unconfigured taxes. Deterministic catalog filter; no LLM or invented products.',
  inputs.recommend.shape,
  (input) => service.recommend(input),
);
tool(
  'merch_quote',
  'Prepare an expiring demo estimate for the shopper-selected item. Reuse requestKey for identical retries. Singapore-only fixture; no order, inventory hold, wallet connection or payment request.',
  inputs.quote.shape,
  (input) => service.quote(input),
);
tool(
  'merch_record_intent',
  'Record the shopper’s explicit answer to a displayed demo quote: crypto preference, card preference, or would not buy. Never infer an answer or call this a purchase. Records one initial decision per session; identical retries are safe. Automated demos must use the automated cohort.',
  inputs.decision.shape,
  (input) => service.decision(input),
);
tool(
  'merch_report',
  'Read local operator experiment counts split by acquisition label. Session counts and reported intentions are not sales or verified humans. Local operator tool; no public or tenant authentication.',
  {},
  () => service.report(),
  true,
);
await server.connect(new StdioServerTransport());
process.once('exit', () => service.close());
