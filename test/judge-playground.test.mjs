import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptySummary, readSummary, reportText } from '../judge-site/try/model.mjs';
const origin = 'https://judges.example';
const source = {};
const payload = () => ({ ...emptySummary(), source: 'launchlab-judge-sample', version: 1, mode: 'browser-local', scope: 'current-page-visit' });
const read = value => readSummary({ data: value, origin, source }, { origin, source });
function action(value, id, count) {
  const row = value.eventCounts.find(row => row.id === id); row.occurrences = count; row.sessions = count ? 1 : 0;
  value.recordedSessions = value.eventCounts.some(row => row.occurrences) ? 1 : 0;
  value.briefsCreated = value.eventCounts.find(row => row.id === 'brief_created').occurrences;
  return value;
}
test('only the actual same-origin sample frame can supply a summary', () => {
  assert.ok(read(payload()));
  assert.equal(readSummary({ data: payload(), origin: 'https://other.example', source }, { origin, source }), null);
  assert.equal(readSummary({ data: payload(), origin, source: {} }, { origin, source }), null);
  assert.equal(readSummary({ data: payload(), origin, source: null }, { origin, source: null }), null);
});
test('rejects private fields, duplicate or unknown actions and malformed observations', () => {
  assert.equal(read({ ...payload(), comment: 'private feedback' }), null);
  for (const mutate of [
    value => { value.eventCounts[0].session = 'private'; },
    value => { value.eventCounts[0].id = 'unknown'; },
    value => { value.eventCounts[1].id = 'page_view'; },
    value => { value.briefsCreated = NaN; },
    value => { value.feedbackResponses = 2; },
    value => { value.eventCounts[0].occurrences = -1; },
    value => { value.consent = 'yes'; },
    value => { value.mode = 'hosted'; },
  ]) { const value = payload(); mutate(value); assert.equal(read(value), null); }
});
test('repeat brief actions count separately, without multiplying recorded visits', () => {
  const value = action(action(payload(), 'page_view', 1), 'brief_created', 2);
  value.feedbackResponses = 1; value.consent = true;
  const result = read(value);
  assert.equal(result.briefsCreated, 2); assert.equal(result.recordedSessions, 1); assert.equal(result.feedbackResponses, 1);
  value.briefsCreated = 1; assert.equal(read(value), null);
});
test('feedback can exist with zero recorded activity and activity can remain after opting out', () => {
  const value = payload(); value.feedbackResponses = 1;
  assert.equal(read(value).recordedSessions, 0);
  action(value, 'brief_created', 2); assert.equal(read(value).consent, false);
});
test('bounded retention permits an evicted first page-view but rejects impossible totals', () => {
  const value = action(payload(), 'brief_created', 400);
  assert.equal(read(value).recordedSessions, 1);
  action(value, 'brief_copied', 1); assert.equal(read(value), null);
  const mismatch = action(payload(), 'brief_created', 2);
  mismatch.eventCounts.find(row => row.id === 'brief_created').sessions = 0;
  assert.equal(read(mismatch), null);
});
test('export makes browser-local and demand limits explicit and contains counts only', () => {
  const text = reportText(action(payload(), 'brief_created', 2));
  assert.match(text, /Brief creation actions: 2/);
  assert.match(text, /local rehearsal actions/);
  assert.match(text, /No paid OKX task/);
  assert.doesNotMatch(text, /@|session[_-]id|private feedback/);
});
test('copyable and downloaded prompts match and do not preapprove a payment or budget', async () => {
  const root = new URL('../judge-site/try/', import.meta.url);
  const [html, prompt] = await Promise.all([readFile(new URL('index.html', root), 'utf8'), readFile(new URL('prompt.txt', root), 'utf8')]);
  const content = html.match(/<textarea id="buyer-prompt"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
  assert.equal(content?.trim(), prompt.trim());
  assert.match(prompt, /Agent 13905/); assert.match(prompt, /ask before purchasing/);
  assert.doesNotMatch(prompt, /0\.01|41034|0x[a-f\d]{64}|approve.*budget|API_KEY/i);
});
