import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDeployment } from '../src/deployment-preflight.mjs';
import { fixture } from './helpers.mjs';

const sha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const repoUrl = 'https://github.com/example/project';
const request = { repoUrl, ref: 'feature/demo' };
function githubFixture(t, files, { truncated = false, requestLog = [], token } = {}) {
  const actualFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname !== 'api.github.com') return actualFetch(url, options);
    requestLog.push({ url: String(url), options });
    if (token) assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    if (parsed.pathname.includes('/commits/'))
      return Response.json({ sha, commit: { tree: { sha: treeSha } } });
    if (parsed.pathname.includes('/git/trees/'))
      return Response.json({
        truncated,
        tree: Object.entries(files).map(([path, content]) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: 'c'.repeat(40),
          size: Buffer.byteLength(content),
        })),
      });
    assert.equal(parsed.searchParams.get('ref'), sha);
    const path = decodeURIComponent(parsed.pathname.split('/contents/')[1]);
    assert.ok(Object.hasOwn(files, path), path);
    return Response.json({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(files[path]).toString('base64'),
    });
  });
  return requestLog;
}

test('normal Next.js repository is inspected at one commit without a LaunchLab manifest or build execution', async (t) => {
  const log = githubFixture(t, {
    'package.json': JSON.stringify({
      dependencies: { next: '16.0.0' },
      scripts: { build: 'next build' },
    }),
    'package-lock.json': '{}',
    'app/page.tsx': 'export default function Page() {}',
  });
  const result = await inspectDeployment(request, { githubToken: '' });
  assert.equal(result.status, 'inspection_complete');
  assert.equal(result.source.commitSha, sha);
  assert.equal(result.detected.framework, 'nextjs');
  assert.equal(result.detected.packageManager, 'npm');
  assert.equal(result.deploymentPlan.source.commitSha, sha);
  assert.equal(result.deploymentPlan.build.command, 'npm run build');
  assert.equal(result.deploymentPlan.install.command, 'npm ci');
  assert.equal(result.deploymentPlan.output.directory, null);
  assert.equal(result.deploymentPlan.canDeploy, false);
  assert.equal(result.deploymentPlan.status, 'configuration_candidate');
  assert.ok(result.evidence.some((item) => item.path === 'package.json'));
  assert.equal(result.deployed, false);
  assert.equal(result.buildExecuted, false);
  assert.equal(log.length, 3);
  assert.ok(log[0].url.endsWith('/commits/feature%2Fdemo'));
  assert.ok(log[1].url.includes(`/git/trees/${treeSha}`));
  assert.ok(log.slice(2).every((r) => r.url.endsWith(`?ref=${sha}`)));
});

test('monorepo asks which app to deploy before reading unrelated package configuration', async (t) => {
  const files = {
    'package.json': '{}',
    'apps/web/package.json': JSON.stringify({
      devDependencies: { vite: '7' },
      scripts: { build: 'vite build' },
    }),
    'pnpm-lock.yaml': '',
    'apps/web/index.html': '<html></html>',
  };
  const log = githubFixture(t, files);
  const result = await inspectDeployment(request, { githubToken: '' });
  assert.equal(result.status, 'needs_input');
  assert.deepEqual(result.questions[0].options, ['.', 'apps/web']);
  assert.equal(log.length, 2);
  const selected = await inspectDeployment(
    { repoUrl, ref: sha, rootDirectory: 'apps/web' },
    { githubToken: '' },
  );
  assert.equal(selected.detected.framework, 'vite');
  assert.equal(selected.detected.packageManager, 'pnpm');
  assert.equal(selected.status, 'needs_input');
  assert.ok(selected.questions.some((item) => item.id === 'workspaceBuild'));
  assert.equal(selected.deploymentPlan.build.command, null);
  assert.equal(selected.deploymentPlan.install.workingDirectory, '.');
});

test('environment templates yield names only; actual secrets, script bodies and .env stay out of tool output', async (t) => {
  const token = 'unit-test-github-credential';
  const log = githubFixture(
    t,
    {
      'package.json': JSON.stringify({
        dependencies: { next: '16' },
        scripts: { build: 'echo embedded-script-secret && next build' },
      }),
      'package-lock.json': '{}',
      '.env.example': 'DATABASE_URL=template-secret\nNEXT_PUBLIC_CHAIN_ID=1952\n',
      '.env': 'PRIVATE_KEY=never-read-this',
    },
    { token },
  );
  const result = await inspectDeployment(request, { githubToken: token });
  assert.deepEqual(result.detected.environmentKeys, ['DATABASE_URL', 'NEXT_PUBLIC_CHAIN_ID']);
  assert.ok(result.questions.some((q) => q.id === 'environment'));
  assert.ok(result.questions.some((q) => q.id === 'externalServices'));
  const output = JSON.stringify(result);
  for (const secret of [token, 'template-secret', 'embedded-script-secret', 'never-read-this'])
    assert.ok(!output.includes(secret));
  assert.ok(!log.some((r) => new URL(r.url).pathname.endsWith('/.env')));
});

test('inaccessible repository returns a connection question without claiming it does not exist', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  const result = await inspectDeployment(request, { githubToken: '' });
  assert.equal(result.status, 'needs_access');
  assert.equal(result.source.commitSha, null);
  assert.equal(result.questions[0].kind, 'connection');
  assert.equal(result.connections.github, 'access_unverified');
  assert.equal(result.deploymentPlan, null);
});

test('foreign URLs, path traversal and submitted credentials are rejected before any network access', async () => {
  for (const input of [
    { ...request, repoUrl: 'https://evil.example/example/repo' },
    { ...request, rootDirectory: '../private' },
    { ...request, githubToken: 'do-not-accept' },
    { ...request, environment: { SECRET: 'do-not-accept' } },
  ])
    await assert.rejects(() => inspectDeployment(input, { githubToken: '' }));
});

test('incomplete trees and rate limits do not masquerade as a successful inspection', async (t) => {
  githubFixture(t, { 'index.html': '<html></html>' }, { truncated: true });
  await assert.rejects(() => inspectDeployment(request, { githubToken: '' }), /incomplete/);
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
  );
  await assert.rejects(() => inspectDeployment(request, { githubToken: '' }), /rate limit/);
});

test('ambiguous framework, conflicting managers and missing build command produce explicit questions', async (t) => {
  githubFixture(t, {
    'package.json': JSON.stringify({ dependencies: { next: '16', vite: '7' } }),
    'package-lock.json': '{}',
    'yarn.lock': '',
  });
  const ambiguous = await inspectDeployment(request, { githubToken: '' });
  assert.equal(ambiguous.detected.framework, 'ambiguous');
  assert.ok(ambiguous.questions.some((q) => q.id === 'framework'));
  assert.ok(ambiguous.questions.some((q) => q.id === 'packageManager'));
  t.mock.restoreAll();
  githubFixture(t, {
    'package.json': JSON.stringify({ dependencies: { next: '16' } }),
    'package-lock.json': '{}',
  });
  const missing = await inspectDeployment(request, { githubToken: '' });
  assert.ok(missing.questions.some((q) => q.id === 'buildCommand'));
});

test('inspection endpoint obeys existing origin checks and leaves project/run state unchanged', async (t) => {
  const f = await fixture(t);
  githubFixture(t, { 'index.html': '<html></html>' });
  const post = (origin, input) =>
    fetch(`${f.origin}/api/deployments/inspect`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  assert.equal((await post('https://evil.example', request)).status, 403);
  const response = await post(f.origin, request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.detected.framework, 'static');
  assert.equal(result.deploymentPlan.delivery, 'static_assets');
  assert.equal(result.deploymentPlan.output.directory, '.');
  assert.equal(result.deploymentPlan.adapter.implemented, false);
  assert.equal(f.store.read().projects.length, 0);
  assert.equal(f.store.read().runs.length, 0);
});
