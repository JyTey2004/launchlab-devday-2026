import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Domain } from '../src/domain.mjs';
import { Services } from '../src/services.mjs';
import { Runs } from '../src/runs.mjs';
import { fixture, negativeFeedback } from './helpers.mjs';

export const brief = {
  requestKey: 'first-run-request',
  title: 'First-use agent directory test',
  goal: 'Learn whether a new builder understands what happens after preparing a request.',
  audience: 'First-time X Layer builders',
  task: 'Choose a service, prepare a request and report the first confusing step.',
  participants: 3,
  budget: 31,
};
function reopen(t, f) {
  const store = new Store(join(f.path, 'test.sqlite'));
  t.after(() => store.close());
  const domain = new Domain(store);
  return new Runs(domain, new Services(domain, f.services.artifactsDir, f.services.previewOrigin));
}

test('planning is atomic across connections, pins scope and works with an older database', async (t) => {
  const f = await fixture(t);
  f.store.change((state) => {
    delete state.runs;
  });
  const runs = new Runs(f.domain, f.services);
  const other = reopen(t, f);
  const [one, two] = await Promise.all([runs.plan(brief), other.plan(brief)]);
  assert.equal(one.id, two.id);
  assert.equal(one.status, 'planned');
  assert.equal(one.plan.source.digest, one.project.sourceDigest);
  assert.deepEqual(one.plan.costs, {
    unit: 'demo credits',
    cap: 31,
    rewardPerAcceptedSubmission: 10,
    rewardPool: 30,
    unallocated: 1,
    realMoneyCharged: 0,
  });
  const state = f.store.read();
  assert.equal(state.projects.length, 1);
  assert.equal(state.runs.length, 1);
  assert.equal(state.releases.length, 0);
  assert.equal(state.campaigns.length, 0);
  await assert.rejects(() => runs.plan({ ...brief, budget: 40 }), /different brief/);
  // A lost plan response can be retried without re-fetching a moving upstream ref.
  f.services.inspectProject = async () => {
    throw new Error('upstream unavailable');
  };
  assert.equal((await runs.plan(brief)).planDigest, one.planDigest);
});

test('run validation and mismatched confirmation cannot start work', async (t) => {
  const f = await fixture(t);
  const runs = new Runs(f.domain, f.services);
  for (const input of [
    { ...brief, budget: 2 },
    { ...brief, participants: 0 },
    { ...brief, participants: 1, budget: 10001 },
    { ...brief, ref: 'main' },
    { ...brief, arbitraryBuild: 'npm install' },
  ])
    await assert.rejects(() => runs.plan(input));
  assert.equal(f.store.read().projects.length, 0);
  const plan = await runs.plan(brief);
  await assert.rejects(() => runs.start(plan.id, { planDigest: '0'.repeat(64) }), /does not match/);
  assert.equal(f.store.read().releases.length, 0);
  assert.equal(runs.get(plan.id).status, 'planned');
});

test('start retries and simultaneous callers create only one release and campaign', async (t) => {
  const f = await fixture(t);
  const runs = new Runs(f.domain, f.services);
  const other = reopen(t, f);
  const plan = await runs.plan(brief);
  const confirm = { planDigest: plan.planDigest };
  const [one, two] = await Promise.all([
    runs.start(plan.id, confirm),
    other.start(plan.id, confirm),
  ]);
  assert.equal(one.status, 'collecting');
  assert.ok(['preparing', 'collecting'].includes(two.status));
  const retried = await other.start(plan.id, confirm);
  assert.equal(retried.report.campaign.id, one.report.campaign.id);
  assert.equal(f.store.read().releases.length, 1);
  assert.equal(f.store.read().campaigns.length, 1);
  assert.equal(retried.report.campaign.budget, 30);
  assert.equal((await fetch(retried.links.preview)).status, 200);
  assert.match(retried.links.experiment, /^\/app#experiment=cmp_/);
  assert.equal(other.list()[0].status, 'collecting');
});

test('a failed preview blocks recruitment and can be retried against the same pinned plan', async (t) => {
  const f = await fixture(t);
  const broken = new Services(
    f.domain,
    join(f.path, 'wrong-origin-artifacts'),
    f.services.previewOrigin,
  );
  const runs = new Runs(f.domain, broken);
  const plan = await runs.plan(brief);
  const failed = await runs.start(plan.id, { planDigest: plan.planDigest });
  assert.equal(failed.status, 'blocked');
  assert.match(failed.blocker.message, /probe failed/);
  assert.equal(failed.release.status, 'failed');
  assert.equal(f.store.read().campaigns.length, 0);
  const resumed = await new Runs(f.domain, f.services).start(plan.id, {
    planDigest: plan.planDigest,
  });
  assert.equal(resumed.status, 'collecting');
  assert.equal(resumed.planDigest, plan.planDigest);
  assert.equal(resumed.project.id, plan.project.id);
  assert.notEqual(resumed.release.id, failed.release.id);
  assert.equal(f.store.read().campaigns.length, 1);
});

test('an expired preparation is fenced so a delayed worker cannot publish another campaign', async (t) => {
  const f = await fixture(t);
  const runs = new Runs(f.domain, f.services);
  const plan = await runs.plan(brief);
  const prepare = f.services.prepareRelease.bind(f.services);
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  f.services.prepareRelease = async (releaseId) => {
    await gate;
    return prepare(releaseId);
  };
  const oldAttempt = runs.start(plan.id, { planDigest: plan.planDigest });
  t.after(() => resume());
  const interruptedRelease = runs.get(plan.id).release.id;
  assert.equal(runs.get(plan.id).status, 'preparing');
  f.store.change((state) => {
    state.runs[0].leaseUntil = '2020-01-01T00:00:00Z';
  });
  const recovered = await reopen(t, f).start(plan.id, { planDigest: plan.planDigest });
  assert.equal(recovered.status, 'collecting');
  assert.notEqual(recovered.release.id, interruptedRelease);
  resume();
  assert.equal((await oldAttempt).status, 'collecting');
  assert.equal(f.store.read().campaigns.length, 1);
  assert.equal(f.store.read().releases.find((r) => r.id === interruptedRelease).status, 'failed');
});

test('a verified release is reused after interruption before campaign creation', async (t) => {
  const f = await fixture(t);
  const runs = new Runs(f.domain, f.services);
  const plan = await runs.plan(brief);
  const verify = f.services.verifyRelease.bind(f.services);
  let resume;
  let ready;
  const reachedVerification = new Promise((resolve) => {
    ready = resolve;
  });
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  f.services.verifyRelease = async (releaseId) => {
    ready();
    await gate;
    return verify(releaseId);
  };
  const interrupted = runs.start(plan.id, { planDigest: plan.planDigest });
  t.after(() => resume());
  await reachedVerification;
  const releaseId = runs.get(plan.id).release.id;
  assert.equal(runs.get(plan.id).release.status, 'ready');
  assert.equal(f.store.read().campaigns.length, 0);
  f.store.change((state) => {
    state.runs[0].leaseUntil = '2020-01-01T00:00:00Z';
  });
  const recovered = await reopen(t, f).start(plan.id, { planDigest: plan.planDigest });
  resume();
  assert.equal((await interrupted).status, 'collecting');
  assert.equal(recovered.release.id, releaseId);
  assert.equal(f.store.read().releases.length, 1);
  assert.equal(f.store.read().campaigns.length, 1);
});

test('run reports follow actual feedback and closing preserves outstanding obligations', async (t) => {
  const f = await fixture(t);
  const runs = new Runs(f.domain, f.services);
  const plan = await runs.plan({ ...brief, participants: 1, budget: 10 });
  const live = await runs.start(plan.id, { planDigest: plan.planDigest });
  const session = f.domain.reserve(live.report.campaign.id, 'automated-test-fixture');
  const feedback = f.domain.submit(session.id, session.token, negativeFeedback);
  assert.equal(runs.get(plan.id).status, 'reviewing');
  assert.equal(runs.get(plan.id).progress.pendingReview, 1);
  assert.ok(!JSON.stringify(runs.get(plan.id)).includes(session.token));
  f.domain.review(
    feedback.id,
    'accept',
    'Automated test fixture: a documented negative observation qualifies.',
  );
  assert.equal(runs.get(plan.id).status, 'completed');
  assert.equal(runs.get(plan.id).progress.verifiedHumanParticipants, null);
  assert.equal(runs.get(plan.id).report.summary.demandValidated, false);
  assert.equal(runs.close(plan.id).status, 'closed');
  assert.equal(runs.close(plan.id).report.campaign.pool.awarded, 10);
  await assert.rejects(() => runs.start(plan.id, { planDigest: plan.planDigest }), /closed/);

  const next = await runs.plan({ ...brief, requestKey: 'second-run-request' });
  const active = await runs.start(next.id, { planDigest: next.planDigest });
  const held = f.domain.reserve(active.report.campaign.id, 'waiting-test-fixture');
  runs.close(next.id);
  assert.throws(() => f.domain.reserve(active.report.campaign.id, 'new-fixture'), /closed/);
  const late = f.domain.submit(held.id, held.token, negativeFeedback);
  f.domain.review(late.id, 'accept', 'Existing reservation remains eligible after the run closes.');
  assert.equal(runs.get(next.id).report.campaign.pool.awarded, 10);
  assert.equal(runs.get(next.id).status, 'closed');
});

test('run HTTP endpoints enforce origin and return status, reports and bounded input errors', async (t) => {
  const f = await fixture(t);
  const post = (path, input, origin = f.origin) =>
    fetch(`${f.origin}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(input),
    });
  assert.equal((await post('/runs', brief, 'https://evil.example')).status, 403);
  assert.equal((await post('/runs', { ...brief, budget: 0 })).status, 400);
  const planned = await post('/runs', brief);
  assert.equal(planned.status, 201);
  const plan = await planned.json();
  const start = `/runs/${plan.id}/start`;
  assert.equal((await post(start, { planDigest: '0'.repeat(64) })).status, 409);
  const opened = await post(start, { planDigest: plan.planDigest });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).status, 'collecting');
  const poll = await fetch(`${f.origin}/api/runs/${plan.id}`).then((r) => r.json());
  assert.equal(poll.report.feedback.length, 0);
  assert.equal((await fetch(`${f.origin}/api/runs`).then((r) => r.json())).length, 1);
  assert.equal((await post(`/runs/${plan.id}/close`, {})).status, 200);
  assert.equal((await post(start, { planDigest: plan.planDigest })).status, 409);
});
