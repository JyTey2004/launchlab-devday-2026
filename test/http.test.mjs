import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { get } from 'node:http';
import { fixture, campaign, negativeFeedback } from './helpers.mjs';
import { Services } from '../src/services.mjs';

test('website and workspace have separate entry points with bounded static assets', async (t) => {
  const f = await fixture(t);
  const landing = await fetch(f.origin);
  const html = await landing.text();
  assert.equal(landing.status, 200);
  assert.match(html, /href="\/app"/);
  assert.match(html, /id="brief-form"/);
  assert.doesNotMatch(html, /src="\/app.js"/);
  assert.match(landing.headers.get('content-security-policy'), /script-src 'self'/);
  const workspace = await fetch(`${f.origin}/app`);
  assert.equal(workspace.status, 200);
  assert.match(await workspace.text(), /src="\/app.js"/);
  const assets = [...html.matchAll(/(?:src|href)="(\/[a-z-]+\.(?:css|js|svg))"/g)].map((m) => m[1]);
  for (const path of new Set(assets)) {
    const response = await fetch(`${f.origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.equal((await fetch(`${f.origin}/.env`)).status, 404);
  assert.equal((await fetch(`${f.origin}/workspace.html`)).status, 404);
});

test('HTTP loop: import, real preview, campaign, feedback, review, report', async (t) => {
  const f = await fixture(t);
  async function post(path, data) {
    const response = await fetch(`${f.origin}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: f.origin },
      body: JSON.stringify(data),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const project = await post('/projects', {});
  const release = await post('/releases', { projectId: project.id });
  const preview = await fetch(release.previewUrl);
  assert.match(await preview.text(), /Hello X Layer/);
  assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts allow-forms/);
  const c = await post('/campaigns', {
    releaseId: release.id,
    title: 'HTTP end-to-end test',
    audience: 'Agent builders',
    task: 'Try the directory and report any confusing steps.',
    budget: 30,
    reward: 10,
  });
  const session = await post(`/campaigns/${c.id}/reserve`, { participantId: 'http-tester' });
  const feedback = await post(`/sessions/${session.id}/feedback`, {
    token: session.token,
    feedback: negativeFeedback,
  });
  await post(`/feedback/${feedback.id}/review`, {
    decision: 'accept',
    reason: 'Clear steps and an honest description of the blocker.',
  });
  const report = await fetch(`${f.origin}/api/campaigns/${c.id}/report`).then((r) => r.json());
  assert.equal(report.campaign.pool.awarded, 10);
  assert.equal(report.summary.demandValidated, false);
});
test('mutations reject cross-origin requests and accept an explicit agent token', async (t) => {
  const f = await fixture(t);
  const request = (headers) =>
    fetch(`${f.origin}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
  assert.equal((await request({})).status, 403);
  assert.equal((await request({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request({ Authorization: 'Bearer bad-token' })).status, 403);
  assert.equal((await request({ Authorization: 'Bearer test-token-for-agent' })).status, 201);
  // Node fetch normalizes Host; use raw HTTP so the test actually sends the hostile header.
  const rebound = await new Promise((resolve, reject) =>
    get(`${f.origin}/api/overview`, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject),
  );
  assert.equal(rebound, 403);
});
test('failed preview checks never create a ready release or recruit testers', async (t) => {
  const f = await fixture(t);
  const project = await f.services.importProject();
  const broken = new Services(f.domain, join(f.path, 'broken-artifacts'), f.services.previewOrigin);
  await assert.rejects(() => broken.deploy(project.id), /probe failed/);
  const release = f.domain.overview().releases[0];
  assert.equal(release.status, 'failed');
  await assert.rejects(
    () => f.services.createCampaign({ releaseId: release.id }),
    /verified preview/,
  );
  const { campaign: c, release: good } = await campaign(f.services);
  await rm(join(f.path, 'artifacts', good.id, 'index.html'));
  await assert.rejects(() => f.services.createCampaign({ ...c, title: 'Unavailable preview' }));
});
test('invalid data and oversized requests fail without creating projects', async (t) => {
  const f = await fixture(t);
  const request = (data) =>
    fetch(`${f.origin}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: f.origin },
      body: data,
    });
  assert.equal((await request('null')).status, 400);
  assert.equal((await request('{broken')).status, 400);
  assert.equal((await request(JSON.stringify({ unexpected: true }))).status, 400);
  assert.equal((await request(JSON.stringify({ repoUrl: 'x'.repeat(25000) }))).status, 413);
  assert.equal(f.domain.overview().projects.length, 0);
});
