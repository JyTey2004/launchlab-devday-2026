import { createServer } from 'node:http';
import { requireThat } from '../store.mjs';
import { workflowGateway } from './gateway.mjs';
import { providerManifest, providerPaths } from '../okx/contracts.mjs';
import { ProviderService } from '../okx/service.mjs';
import { handleProviderMcp } from '../okx/mcp.mjs';

async function body(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'Use application/json.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; requireThat(size <= 16384, 'Request body is too large.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
export function hostedServer({ store, workflows }) {
  const windows = new Map();
  const limited = (key, maximum) => {
    const minute = Math.floor(Date.now() / 60000), entry = windows.get(key);
    const value = entry?.minute === minute ? entry : { minute, count: 0 };
    value.count++; windows.set(key, value);
    if (windows.size > 1000) for (const [name, record] of windows) if (record.minute !== minute) windows.delete(name);
    requireThat(value.count <= maximum, 'Request rate limit reached. Retry in one minute.', 429);
  };
  const server = createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(store.workerReady() ? 200 : 503, { service: 'LaunchLab', status: store.workerReady() ? 'ready' : 'worker_unavailable' });
      limited('global', 1000);
      const tenant = store.authenticate(req.headers.authorization);
      limited(tenant, 120);
      const gateway = workflowGateway({ store, workflows }, tenant);
      if (url.pathname.startsWith('/api/okx/')) {
        // Agent-to-service transport only. No browser origins or permissive CORS.
        requireThat(!req.headers.origin, 'Browser-origin requests are not supported by the provider interface.', 403);
        const provider = new ProviderService(gateway);
        if (url.pathname === providerPaths.service && req.method === 'GET') return send(200, providerManifest());
        if (url.pathname === providerPaths.invoke && req.method === 'POST') {
          const result = await provider.invoke(await body(req));
          return send(result.status, result.value);
        }
        if (url.pathname === providerPaths.mcp) {
          if (req.method !== 'POST') return send(405, { error: 'Use POST for stateless MCP requests.' });
          return await handleProviderMcp(req, res, await body(req), provider);
        }
        return send(404, { error: 'Route not found.' });
      }
      const jobMatch = /^\/api\/agent\/jobs\/(job_[a-f0-9]{24})$/.exec(url.pathname);
      if (jobMatch && req.method === 'GET') return send(200, gateway.job(jobMatch[1]));
      if (url.pathname === '/api/agent/workflows' && req.method === 'POST') {
        return send(202, gateway.submit(await body(req)));
      }
      const match = /^\/api\/agent\/workflows\/(wf_[a-f0-9]{20})(?:\/(answers|start|resume|analyze|report|access))?$/.exec(url.pathname);
      requireThat(match, 'Route not found.', 404);
      const [, id, operation] = match; store.owns(tenant, id);
      if (req.method === 'GET') {
        if (!operation) return send(200, await gateway.get(id));
        if (operation === 'access') return send(200, await gateway.access(id));
        if (operation === 'report') return send(200, await gateway.report(id, Object.fromEntries(url.searchParams)));
      }
      if (req.method === 'POST') {
        return send(202, gateway.mutate(id, operation, await body(req), req.headers['idempotency-key']));
      }
      send(404, { error: 'Route not found.' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error.name === 'ZodError' ? 400 : (error.status || 500);
      send(status, { error: error.name === 'ZodError' ? 'Input does not match the workflow contract.' : status < 500 ? error.message : 'Service temporarily unavailable.' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  return server;
}
