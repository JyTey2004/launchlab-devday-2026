import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { inputs } from './service.mjs';

const origin = new URL(process.env.MERCH_URL || 'http://localhost:5173');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) {
  throw new Error('Remote merchant services must use HTTPS.');
}
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('MERCH_URL must be a service origin without credentials, path or query.');
}
const sessions = new Map();
const opens = new Map();
const server = new McpServer({ name: 'proof-of-reps-online', version: '0.1.0' });
async function api(path, body, token) {
  const response = await fetch(new URL(`/api/${path}`, origin), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'X-Merch-Client': 'agent',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(process.env.MERCH_SITES_ACCESS_TOKEN ? { 'OAI-Sites-Authorization': `Bearer ${process.env.MERCH_SITES_ACCESS_TOKEN}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Merchant service returned ${response.status}`);
  return value;
}
function sessionToken(sessionId) {
  const token = sessions.get(sessionId);
  if (!token) throw new Error('Open a shopping session through this connection first.');
  return token;
}
function tool(name, description, schema, execute, readOnly = false) {
  server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true } }, async input => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await execute(input)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
tool('merch_open', 'Open an automated-labelled session in the hosted concept store and return its catalog. Tokens stay inside this connector. Reuse requestKey within this MCP process; keep the process alive for the workflow. No real products or payments.', inputs.open.shape, async ({ requestKey }) => {
  if (!opens.has(requestKey)) {
    // Store the in-flight promise so concurrent retries share one creation.
    const pending = api('session', {}).then(session => {
      sessions.set(session.sessionId, session.sessionToken);
      const { sessionToken: secret, ...publicSession } = session;
      return publicSession;
    });
    opens.set(requestKey, pending);
    pending.catch(() => opens.delete(requestKey));
  }
  return { ...await opens.get(requestKey), ...await api('catalog') };
});
tool('merch_recommend', 'Filter the hosted catalog by activity, size and an illustrative USD budget in cents, including fixture shipping but excluding unconfigured taxes.', inputs.recommend.shape, ({ sessionId, ...body }) => { sessionToken(sessionId); return api('recommend', body); }, true);
tool('merch_quote', 'Prepare a demo estimate for the shopper-selected item using the same server as the storefront. Reuse requestKey for retries. No wallet, order or payment.', inputs.quote.shape, ({ sessionId, ...body }) => api('quote', body, sessionToken(sessionId)));
tool('merch_record_intent', 'Record an explicit preference on the hosted store. Do not infer purchase intent. Calls from this connector are labelled automated, not organic traction. No payment or order is created.', inputs.decision.shape, ({ sessionId, ...body }) => api('intent', body, sessionToken(sessionId)));
tool('merch_report', 'Read the private aggregate report. Requires an operator-provided MERCH_ADMIN_API_KEY; no key is exposed to the calling agent.', {}, () => {
  if (!process.env.MERCH_ADMIN_API_KEY) throw new Error('Operator report access is not configured.');
  return api('report', undefined, process.env.MERCH_ADMIN_API_KEY);
}, true);
await server.connect(new StdioServerTransport());
