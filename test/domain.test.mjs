import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Domain } from '../src/domain.mjs';
import { parseRepository } from '../src/repos.mjs';
import { fixture, campaign, negativeFeedback } from './helpers.mjs';

test('reward reservations cannot overspend across database connections', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services, 20, 10);
  const other = new Store(join(f.path, 'test.sqlite'));
  t.after(() => other.close());
  f.domain.reserve(c.id, 'tester-one');
  new Domain(other).reserve(c.id, 'tester-two');
  assert.throws(() => f.domain.reserve(c.id, 'tester-three'), /All reward slots/);
  assert.deepEqual(f.domain.report(c.id).campaign.pool, {
    budget: 20,
    reserved: 20,
    awarded: 0,
    available: 0,
    unit: 'demo credits',
  });
});
test('documented failure with a low rating earns its reward exactly once', async (t) => {
  const f = await fixture(t);
  const { campaign: c, release } = await campaign(f.services);
  const session = f.domain.reserve(c.id, 'honest-tester');
  const feedback = f.domain.submit(session.id, session.token, negativeFeedback);
  assert.equal(feedback.releaseId, release.id);
  assert.equal(feedback.sourceDigest, release.sourceDigest);
  f.domain.review(
    feedback.id,
    'accept',
    'Specific, reproducible steps describe a legitimate product blocker.',
  );
  f.domain.review(feedback.id, 'accept', 'Retry after a network interruption.');
  assert.equal(f.store.read().ledger.length, 1);
  assert.equal(f.domain.report(c.id).campaign.pool.awarded, 10);
  assert.equal(f.store.read().ledger[0].transactionHash, null);
  assert.throws(
    () => f.domain.review(feedback.id, 'reject', 'Conflicting repeat decision.'),
    /different review/,
  );
});
test('expired sessions release budget and cannot submit with the old token', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services, 10, 10);
  const expired = f.domain.reserve(c.id, 'late-tester');
  f.store.change((s) => {
    s.reservations[0].expiresAt = '2020-01-01T00:00:00.000Z';
  });
  const fresh = f.domain.reserve(c.id, 'new-tester');
  assert.equal(fresh.reward, 10);
  assert.throws(() => f.domain.submit(expired.id, expired.token, negativeFeedback), /expired/);
});
test('submitted feedback keeps its reward held beyond the session deadline', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services, 10, 10);
  const session = f.domain.reserve(c.id, 'patient-tester');
  f.domain.submit(session.id, session.token, negativeFeedback);
  f.store.change((s) => {
    s.reservations[0].expiresAt = '2020-01-01T00:00:00.000Z';
  });
  assert.throws(() => f.domain.reserve(c.id, 'second-tester'), /All reward slots/);
});
test('duplicate aliases and forged tokens cannot duplicate or steal submissions', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services);
  const session = f.domain.reserve(c.id, 'One-Tester');
  assert.throws(() => f.domain.reserve(c.id, 'one-tester'), /already has/);
  assert.throws(
    () => f.domain.submit(session.id, 'forged', negativeFeedback),
    /Invalid session token/,
  );
  f.domain.submit(session.id, session.token, negativeFeedback);
  assert.throws(
    () => f.domain.submit(session.id, session.token, negativeFeedback),
    /already submitted/,
  );
  assert.ok(!JSON.stringify(f.domain.overview()).includes(session.token));
  assert.ok(!JSON.stringify(f.domain.overview()).includes('tokenHash'));
});
test('rejection releases pool, and closing preserves existing tester commitments', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services, 10, 10);
  const session = f.domain.reserve(c.id, 'tester-one');
  const feedback = f.domain.submit(session.id, session.token, negativeFeedback);
  f.domain.review(
    feedback.id,
    'reject',
    'Reported steps refer to a different product; needs a new session.',
  );
  const next = f.domain.reserve(c.id, 'tester-two');
  f.domain.closeCampaign(c.id);
  assert.throws(() => f.domain.reserve(c.id, 'tester-three'), /closed/);
  const second = f.domain.submit(next.id, next.token, negativeFeedback);
  f.domain.review(second.id, 'accept', 'A detailed observation tied to the actual preview.');
  assert.equal(f.domain.report(c.id).campaign.pool.awarded, 10);
});
test('new deployments never rewrite feedback provenance', async (t) => {
  const f = await fixture(t);
  const { project, release, campaign: c } = await campaign(f.services);
  const session = f.domain.reserve(c.id, 'tester-one');
  const feedback = f.domain.submit(session.id, session.token, negativeFeedback);
  const nextRelease = await f.services.deploy(project.id);
  assert.notEqual(nextRelease.id, release.id);
  assert.equal(f.domain.report(c.id).feedback[0].previewUrl, feedback.previewUrl);
  assert.equal(f.domain.report(c.id).campaign.releaseId, release.id);
});
test('repository parser rejects credentials, foreign hosts and path tricks', () => {
  for (const input of [
    'http://github.com/org/repo',
    'https://github.com.evil.test/a/b',
    'https://secret@github.com/a/b',
    'https://github.com/a/b/tree/main',
    'https://github.com/a/b?token=secret',
    'file:///etc/passwd',
  ])
    assert.throws(() => parseRepository(input));
  assert.deepEqual(parseRepository('https://github.com/example/demo.git'), {
    owner: 'example',
    name: 'demo',
    url: 'https://github.com/example/demo',
  });
});
test('ledger and provenance survive reopening the database', async (t) => {
  const f = await fixture(t);
  const { campaign: c } = await campaign(f.services);
  const session = f.domain.reserve(c.id, 'tester-one');
  const fb = f.domain.submit(session.id, session.token, negativeFeedback);
  f.domain.review(fb.id, 'accept', 'Useful observation with sufficient reproduction steps.');
  const reopened = new Store(join(f.path, 'test.sqlite'));
  t.after(() => reopened.close());
  assert.equal(new Domain(reopened).report(c.id).campaign.pool.awarded, 10);
  assert.equal(reopened.read().feedback[0].sourceDigest, fb.sourceDigest);
});
