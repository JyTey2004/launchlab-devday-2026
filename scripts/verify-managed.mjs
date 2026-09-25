// Explicit internal-QA traffic only. Never present these responses as traction.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ManagedPipeline } from '../src/managed/pipeline.mjs';
import { readJson, writeJson, Aws } from '../src/managed/io.mjs';

const id = process.argv[2];
if (!id || process.argv[3] !== '--test-feedback') throw new Error('Usage: node scripts/verify-managed.mjs DEPLOYMENT_ID --test-feedback (creates internal QA feedback)');
const pipeline = new ManagedPipeline(), run = await pipeline.get(id);
assert.equal(run.status, 'ready');
const secrets = await pipeline.credentials(run);
const aws = new Aws({ ...run.hosting, directory: join(pipeline.folder(id), 'requests') });
const counts = async () => ({
  builds: (await aws.call('codebuild', 'list-builds-for-project', { projectName: run.resources.Builder })).ids.length,
  jobs: (await aws.call('amplify', 'list-jobs', { appId: run.resources.AppId, branchName: 'preview' })).jobSummaries.length,
});
const before = await counts();
assert.equal((await pipeline.plan(run.input)).id, id);
assert.equal((await pipeline.authorize(id, { planDigest: run.planDigest })).status, 'ready');
assert.equal((await pipeline.execute(id)).status, 'ready');
assert.deepEqual(await counts(), before);
const organicBefore = await pipeline.report(id);
const sessionFile = join(pipeline.folder(id), 'qa-session.json');
let session = await readJson(sessionFile);
if (!session || session.expiresAt <= Date.now()) {
  session = { id: randomUUID(), expiresAt: Date.now() + 23 * 3600000 };
  await writeJson(sessionFile, session);
}
async function post(path, body, token) {
  const response = await fetch(run.resources.ApiBase + path, { method: 'POST', headers: { Origin: run.resources.Url, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `Unexpected ${path} status`); return response.json();
}
const experiment = run.instrumentation;
const identity = await post('/sessions', { id: session.id, tracking: true, actor: 'test', source: 'direct', ...(experiment ? { experimentId: experiment.id } : {}) });
const eventIds = experiment ? experiment.design.events.map((e) => e.id) : ['primary_action'];
await post('/events', { events: ['page_view', ...eventIds].map((type) => ({ type })) }, identity.token);
const feedback = { intent: 'maybe', blocker: 'usefulness', rewarded: 'no', comment: 'Internal API pipeline QA: synthetic event and feedback delivery verified. This is not customer demand or a human preference.',
  ...(experiment ? { answers: Object.fromEntries(experiment.design.questions.map((q) => [q.id, q.kind === 'text' ? 'Internal API QA only. No actual customer opinion.' : (q.options.find((o) => ['no_preference','none','neither'].includes(o.id)) || q.options[0]).id])) } : {}) };
await post('/feedback', feedback, identity.token);
const first = await pipeline.report(id, { cohort: 'test' });
await post('/feedback', feedback, identity.token);
const repeated = await pipeline.report(id, { cohort: 'test' });
assert.equal(first.responses, repeated.responses);
assert.ok(repeated.sessions >= 1 && repeated.primaryActions >= 1 && repeated.responses >= 1);
assert.ok(repeated.comments.some((c) => c.comment === feedback.comment));
if (experiment) {
  assert.equal(repeated.experimentId, experiment.id);
  assert.equal(repeated.sourceCommit, run.source.commitSha);
  for (const id of eventIds) assert.ok(repeated.eventCounts.find((e) => e.id === id)?.sessions >= 1);
  assert.equal(repeated.questionResults.length, experiment.design.questions.length);
}
const organicAfter = await pipeline.report(id);
assert.equal(organicAfter.sessions, organicBefore.sessions);
assert.equal(organicAfter.responses, organicBefore.responses);
assert.equal((await fetch(run.resources.ApiBase + '/report', { headers: { Authorization: 'Bearer wrong-project-key' } })).status, 401);
const result = { at: new Date().toISOString(), deploymentId: id, retryCreatedExtraBuildsOrJobs: false, providerCounts: before,
  liveCollectorReadback: true, syntheticTestInput: true, repeatedFeedbackCountedOnce: true, internalQa: { sessions: repeated.sessions, primaryActions: repeated.primaryActions, responses: repeated.responses },
  organic: { sessions: organicAfter.sessions, responses: organicAfter.responses }, browserInteractionTested: false };
await writeJson(join(pipeline.folder(id), 'live-verification.json'), result);
console.log(JSON.stringify(result, null, 2));
