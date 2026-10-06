import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { judgeAdapterSource } from '../scripts/build-judge-sample.mjs';

const { judgeSampleSummary, attachJudgeSummary } = await import('data:text/javascript;base64,' + Buffer.from(judgeAdapterSource).toString('base64'));
const state = () => ({ session: 'private-page-id', consent: true, feedback: [{ session: 'private-page-id', comment: 'private feedback', rating: 4 }],
  events: [{ name: 'page_view', session: 'private-page-id', at: 'private-time' }, { name: 'brief_created', session: 'private-page-id', at: 'private-time' },
    { name: 'brief_created', session: 'private-page-id', arbitrary: 'private-form-field' }, { name: 'price_signal_submitted', session: 'private-page-id', price: 99 },
    { name: 'brief_created', session: 'earlier-visit', at: 'earlier-time' }, { name: 'unrecognized_event', session: 'private-page-id' }], friction: 'private draft' });

test('summary reports actual current-visit repeats and one feedback response, with only sanitized allowlisted fields', () => {
  const summary = judgeSampleSummary(state());
  assert.equal(summary.briefsCreated, 2); assert.equal(summary.recordedSessions, 1); assert.equal(summary.feedbackResponses, 1);
  assert.deepEqual(summary.eventCounts.find(event => event.id === 'brief_created'), { id: 'brief_created', occurrences: 2, sessions: 1 });
  assert.equal(summary.eventCounts.length, 7);
  assert.ok(!JSON.stringify(summary).includes('private'));
  for (const forbidden of ['session', 'at', 'price', 'comment', 'rating', 'friction', 'arbitrary']) assert.equal(Object.hasOwn(summary, forbidden), false);
  assert.equal(summary.scope, 'current-page-visit'); assert.equal(summary.mode, 'browser-local');
});

test('empty current visit and feedback edits never invent activity or unique-user counts', () => {
  assert.equal(judgeSampleSummary({ session: 'new', events: state().events, feedback: state().feedback }).briefsCreated, 0);
  assert.equal(judgeSampleSummary({ session: 'new', events: state().events, feedback: state().feedback }).feedbackResponses, 0);
  assert.equal(judgeSampleSummary({ ...state(), consent: false }).feedbackResponses, 1);
  assert.equal(judgeSampleSummary({ ...state(), feedback: [{ session: 'private-page-id', comment: 'edited opinion' }] }).feedbackResponses, 1);
  assert.equal(judgeSampleSummary({}).recordedSessions, 0);
});

test('summary is bounded to the actual sample retention policy and clear produces zero counts', () => {
  const data = { session: 'current', consent: true,
    events: Array.from({ length: 501 }, () => ({ name: 'brief_created', session: 'current' })),
    feedback: Array.from({ length: 50 }, () => ({ session: 'current', comment: 'retained local opinion' })) };
  const summary = judgeSampleSummary(data);
  assert.equal(summary.briefsCreated, 400); assert.equal(summary.feedbackResponses, 1); assert.equal(summary.recordedSessions, 1);
  assert.ok(summary.eventCounts.every(event => Number.isInteger(event.occurrences) && event.occurrences >= 0 && event.occurrences <= 400));
  const cleared = judgeSampleSummary({ ...data, consent: false, events: [], feedback: [] });
  assert.equal(cleared.consent, false); assert.equal(cleared.briefsCreated, 0); assert.equal(cleared.feedbackResponses, 0);
  assert.ok(cleared.eventCounts.every(event => event.occurrences === 0 && event.sessions === 0));
});

test('adapter posts only to same-origin parent, deduplicates unchanged summary and accepts only its exact read-only request', () => {
  const posted = [], listeners = new Map(), parent = { postMessage: (...args) => posted.push(args) };
  const browser = { parent, location: { protocol: 'https:', origin: 'https://example.test', search: '?judge=1&test=1' },
    addEventListener: (type, callback) => listeners.set(type, callback) };
  const data = state(), adapter = attachJudgeSummary(() => data, browser);
  adapter.publish(); adapter.publish(); assert.equal(posted.length, 1); assert.equal(posted[0][1], browser.location.origin);
  const message = { source: 'launchlab-judge-parent', version: 1, type: 'request-summary' };
  for (const event of [{ origin: 'https://elsewhere.test', source: parent, data: message },
    { origin: browser.location.origin, source: {}, data: message },
    { origin: browser.location.origin, source: parent, data: { ...message, allowed: true } },
    { origin: browser.location.origin, source: parent, data: { ...message, type: 'allow-recording' } }]) listeners.get('message')(event);
  assert.equal(posted.length, 1); assert.equal(data.consent, true);
  listeners.get('message')({ origin: browser.location.origin, source: parent, data: message });
  assert.equal(posted.length, 2); assert.ok(!JSON.stringify(posted).includes('private'));
  data.consent = false; adapter.publish(); assert.equal(posted.length, 3); assert.equal(posted[2][0].consent, false);
});

test('direct sample, missing judge mode or opaque origin never sends data', () => {
  let sent = 0; const parent = { postMessage: () => { sent++; } };
  for (const supplied of [{ parent, location: { protocol: 'https:', search: '?test=1' } },
    { parent, location: { protocol: 'file:', search: '?judge=1' } }, { parent: null, location: { protocol: 'https:', search: '?judge=1' } }]) {
    attachJudgeSummary(state, supplied).publish();
  }
  const direct = { location: { protocol: 'https:', search: '?judge=1' } }; direct.parent = direct;
  attachJudgeSummary(state, direct).publish(); assert.equal(sent, 0);
});

test('built manifest binds exact pinned source and generated asset bytes with portable relative links', async () => {
  const base = new URL('../judge-site/try/sample/', import.meta.url), manifest = JSON.parse(await readFile(new URL('sample-manifest.json', base)));
  assert.equal(manifest.source.commit, '76fa3ae06b8ea8a6a7fd1e58fa82723687296c72'); assert.equal(manifest.base, './');
  assert.equal(manifest.build.modelCalls, 0); assert.equal(manifest.build.networkUsed, false);
  assert.equal(manifest.build.rebuild, 'node scripts/build-judge-sample.mjs /path/to/clean/pulse');
  assert.equal(manifest.adapter.retainedEventLimit, 400); assert.equal(manifest.adapter.feedbackResponsesLimit, 1);
  assert.equal(manifest.files.length, 3);
  for (const file of manifest.files) {
    assert.match(file.path, /^(?:index\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/);
    const bytes = await readFile(new URL(file.path, base)); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const html = await readFile(new URL('index.html', base), 'utf8'); assert.ok(html.includes('./assets/')); assert.ok(!html.includes('src="/assets/'));
  assert.match(manifest.boundary, /No OKX task/); assert.match(manifest.boundary, /not verified people/);
});
