import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { requireThat, DomainError } from './store.mjs';
import { checkNetwork } from './repos.mjs';
import { Runs } from './runs.mjs';
import { inspectDeployment } from './deployment-preflight.mjs';
import { AgentWorkflows } from './agent/workflows.mjs';

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
const types = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
};
const secureEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
function json(res, value, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  requireThat(
    req.headers['content-type']?.split(';')[0] === 'application/json',
    'Use application/json',
    415,
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= 20000, 'Request too large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new DomainError('Invalid JSON');
  }
}
function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}
function hostAllowed(req) {
  return ['127.0.0.1', 'localhost'].some(
    (host) => req.headers.host === `${host}:${req.socket.localPort}`,
  );
}
function browserOriginAllowed(req) {
  return req.headers.origin === `http://${req.headers.host}`;
}
function admin(req, token) {
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  if (token && secureEqual(bearer, token)) return;
  // Local single-operator mode. The server never binds publicly; prevent DNS rebinding and cross-origin requests.
  requireThat(hostAllowed(req), 'Local host required', 403);
  if (req.method === 'GET')
    requireThat(!req.headers.origin || browserOriginAllowed(req), 'Origin not allowed', 403);
  else
    requireThat(
      browserOriginAllowed(req),
      'Same-origin browser request or API token required',
      403,
    );
}
async function serveFile(res, path) {
  const data = await readFile(path);
  res.writeHead(200, {
    'Content-Type': types[path.split('.').pop()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}
export function previewServer(artifactsDir) {
  return createServer(async (req, res) => {
    headers(res);
    res.setHeader(
      'Content-Security-Policy',
      "sandbox allow-scripts allow-forms; default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    try {
      requireThat(hostAllowed(req), 'Local host required', 403);
      requireThat(req.method === 'GET', 'Method not allowed', 405);
      const path = new URL(req.url, 'http://localhost').pathname;
      const match = path.match(
        /^\/releases\/(rel_[a-f0-9]{16})\/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:html|css|js|json|svg|txt))$/,
      );
      requireThat(match, 'Preview not found', 404);
      await serveFile(res, join(artifactsDir, match[1], match[2]));
    } catch (error) {
      json(
        res,
        { error: error.code === 'ENOENT' ? 'Preview file not found' : error.message },
        error.status || 404,
      );
    }
  });
}
export function apiServer(domain, services, token, managed = null, agent = null) {
  const runs = new Runs(domain, services);
  const workflows = agent ? new AgentWorkflows({ agent }) : null;
  return createServer(async (req, res) => {
    headers(res);
    try {
      requireThat(hostAllowed(req), 'Local host required', 403);
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/api/health' && req.method === 'GET')
        return json(res, { status: 'ok', mode: 'local-prototype' });
      if (path.startsWith('/api/')) {
        admin(req, token);
        if (path.startsWith('/api/agent/')) {
          requireThat(agent, 'Enable managed hosting to use the validation agent.', 409);
          if (path.startsWith('/api/agent/workflows')) {
            requireThat(token && secureEqual(req.headers.authorization?.replace(/^Bearer /, ''), token), 'Agent workflows require the operator API token.', 403);
            if (path === '/api/agent/workflows' && req.method === 'POST') return json(res, await workflows.create(await body(req)), 201);
            const workflow = path.match(/^\/api\/agent\/workflows\/(wf_[a-f0-9]{20})(?:\/(answers|start|resume|report|analyze|access))?$/);
            if (workflow && !workflow[2] && req.method === 'GET') return json(res, await workflows.get(workflow[1]));
            if (workflow?.[2] === 'answers' && req.method === 'POST') return json(res, await workflows.answer(workflow[1], await body(req)));
            if (workflow?.[2] === 'start' && req.method === 'POST') return json(res, await workflows.start(workflow[1], await body(req)), 202);
            if (workflow?.[2] === 'resume' && req.method === 'POST') return json(res, await workflows.resume(workflow[1], await body(req)), 202);
            if (workflow?.[2] === 'report' && req.method === 'GET') return json(res, await workflows.report(workflow[1], Object.fromEntries(url.searchParams)));
            if (workflow?.[2] === 'analyze' && req.method === 'POST') return json(res, await workflows.analyze(workflow[1], await body(req)));
            if (workflow?.[2] === 'access' && req.method === 'GET') return json(res, await workflows.access(workflow[1]));
            throw new DomainError('Workflow endpoint not found.', 404);
          }
          // Loopback operator UI uses same-origin requests; MCP uses the private operator token.
          if (path === '/api/agent/status' && req.method === 'GET') return json(res, agent.status());
          if (path === '/api/agent/example' && req.method === 'GET') return json(res, JSON.parse(await readFile(new URL('../examples/proof-reps-validation.json', import.meta.url), 'utf8')));
          if (path === '/api/agent/experiments' && req.method === 'GET') return json(res, await agent.list());
          if (path === '/api/agent/experiments' && req.method === 'POST') return json(res, await agent.plan(await body(req)), 201);
          const experiment = path.match(/^\/api\/agent\/experiments\/(exp_[a-f0-9]{20})(?:\/(start|report|analyze))?$/);
          if (experiment && !experiment[2] && req.method === 'GET') return json(res, await agent.progress(experiment[1]));
          if (experiment?.[2] === 'start' && req.method === 'POST') return json(res, await agent.start(experiment[1], await body(req)), 202);
          if (experiment?.[2] === 'report' && req.method === 'GET') return json(res, await agent.report(experiment[1], { cohort: url.searchParams.get('cohort') || 'organic', days: url.searchParams.get('days') || '7' }));
          if (experiment?.[2] === 'analyze' && req.method === 'POST') {
            const input = await body(req);
            requireThat(Object.keys(input).every((key) => ['cohort','days'].includes(key)), 'Unexpected analysis setting.');
            return json(res, await agent.summarize(experiment[1], input));
          }
          throw new DomainError('Agent endpoint not found.', 404);
        }
        if (path.startsWith('/api/managed-deployments')) {
          requireThat(managed, 'Managed hosting is not enabled. Configure LAUNCHLAB_MANAGED_ENABLED and the operator API token.', 409);
          requireThat(token && secureEqual(req.headers.authorization?.replace(/^Bearer /, ''), token), 'Managed hosting requires the operator API token.', 403);
          if (path === '/api/managed-deployments' && req.method === 'GET') return json(res, await managed.list());
          if (path === '/api/managed-deployments' && req.method === 'POST') return json(res, await managed.plan(await body(req)), 201);
          const deployment = path.match(/^\/api\/managed-deployments\/(dep_[a-f0-9]{20})(?:\/(start|report))?$/);
          if (deployment && !deployment[2] && req.method === 'GET') return json(res, await managed.get(deployment[1]));
          if (deployment?.[2] === 'start' && req.method === 'POST') return json(res, await managed.start(deployment[1], await body(req)), 202);
          if (deployment?.[2] === 'report' && req.method === 'GET') return json(res, await managed.report(deployment[1], { cohort: url.searchParams.get('cohort') || 'organic', days: url.searchParams.get('days') || '7' }));
          throw new DomainError('Managed deployment endpoint not found.', 404);
        }
        if (path === '/api/overview' && req.method === 'GET') return json(res, domain.overview());
        if (path === '/api/network' && req.method === 'GET') return json(res, await checkNetwork());
        if (path === '/api/deployments/inspect' && req.method === 'POST')
          return json(res, await inspectDeployment(await body(req)));
        if (path === '/api/runs' && req.method === 'GET') return json(res, runs.list());
        if (path === '/api/runs' && req.method === 'POST')
          return json(res, await runs.plan(await body(req)), 201);
        const run = path.match(/^\/api\/runs\/(run_[a-f0-9]{16})$/);
        if (run && req.method === 'GET') return json(res, runs.get(run[1]));
        const start = path.match(/^\/api\/runs\/(run_[a-f0-9]{16})\/start$/);
        if (start && req.method === 'POST')
          return json(res, await runs.start(start[1], await body(req)));
        const closeRun = path.match(/^\/api\/runs\/(run_[a-f0-9]{16})\/close$/);
        if (closeRun && req.method === 'POST') return json(res, runs.close(closeRun[1]));
        if (path === '/api/projects' && req.method === 'POST')
          return json(res, await services.importProject(await body(req)), 201);
        if (path === '/api/releases' && req.method === 'POST')
          return json(res, await services.deploy((await body(req)).projectId), 201);
        if (path === '/api/campaigns' && req.method === 'POST')
          return json(res, await services.createCampaign(await body(req)), 201);
        const report = path.match(/^\/api\/campaigns\/(cmp_[a-f0-9]{16})\/report$/);
        if (report && req.method === 'GET') return json(res, domain.report(report[1]));
        const reserve = path.match(/^\/api\/campaigns\/(cmp_[a-f0-9]{16})\/reserve$/);
        if (reserve && req.method === 'POST')
          return json(res, domain.reserve(reserve[1], (await body(req)).participantId), 201);
        const close = path.match(/^\/api\/campaigns\/(cmp_[a-f0-9]{16})\/close$/);
        if (close && req.method === 'POST') return json(res, domain.closeCampaign(close[1]));
        const submit = path.match(/^\/api\/sessions\/(res_[a-f0-9]{16})\/feedback$/);
        if (submit && req.method === 'POST') {
          const input = await body(req);
          return json(res, domain.submit(submit[1], input.token, input.feedback), 201);
        }
        const review = path.match(/^\/api\/feedback\/(fb_[a-f0-9]{16})\/review$/);
        if (review && req.method === 'POST') {
          const input = await body(req);
          return json(res, domain.review(review[1], input.decision, input.reason));
        }
        throw new DomainError('API endpoint not found', 404);
      }
      requireThat(req.method === 'GET', 'Method not allowed', 405);
      const files = {
        '/': 'index.html',
        '/app': 'workspace.html',
        '/app/': 'workspace.html',
        '/agent': 'agent.html',
        '/agent/': 'agent.html',
        '/agent.js': 'agent.js',
        '/agent.css': 'agent.css',
        '/app.js': 'app.js',
        '/style.css': 'style.css',
        '/landing.css': 'landing.css',
        '/landing.js': 'landing.js',
        '/launch-core.svg': 'launch-core.svg',
        '/favicon.svg': 'favicon.svg',
      };
      requireThat(files[path], 'Page not found', 404);
      await serveFile(res, join(WEB_DIR, files[path]));
    } catch (error) {
      const status = error instanceof ZodError ? 400 : error.status || 500;
      if (status === 500) console.error(error);
      json(
        res,
        {
          error:
            error instanceof ZodError
              ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
              : status === 500
                ? 'Operation failed. Check the server log.'
                : error.message,
        },
        status,
      );
    }
  });
}
export const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
