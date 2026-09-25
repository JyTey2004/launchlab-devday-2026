import { mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hash, buildRecipe } from '../managed/contracts.mjs';
import { readJson, writeJson } from '../managed/io.mjs';
import { parseRepository } from '../repos.mjs';
import { requireThat } from '../store.mjs';
import { experimentInput } from './schemas.mjs';
import { workflowInput, workflowAnswer, workflowStart, workflowResume, workflowFilter, workflowId } from './workflow-contracts.mjs';

const stamp = () => new Date().toISOString();
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return true; // Unknown ownership fails closed.
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};
const deploymentActive = new Set(['queued', 'provisioning', 'preparing_source', 'building', 'packaging', 'publishing', 'verifying']);

// A transport-neutral coordinator over the existing GPT experiment and AWS pipeline.
// This is still a trusted, single-operator service, not a public tenant boundary.
export class AgentWorkflows {
  constructor({ agent, directory = join(agent.directory, 'workflows'), ownerAlive = alive }) {
    Object.assign(this, { agent, pipeline: agent.pipeline, directory: resolve(directory), ownerAlive });
  }
  folder(id) { return join(this.directory, workflowId.parse(id)); }
  async load(id) {
    const record = await readJson(join(this.folder(id), 'workflow.json'));
    requireThat(record, 'Workflow not found.', 404);
    return record;
  }
  async save(record, message) {
    record.updatedAt = stamp();
    if (message) record.timeline.push({ at: record.updatedAt, revision: record.revision, message });
    await writeJson(join(this.folder(record.id), 'workflow.json'), record);
  }
  async locked(id, execute, { recover = false } = {}) {
    await mkdir(this.folder(id), { recursive: true, mode: 0o700 });
    const path = join(this.folder(id), 'operation.lock');
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireThat(recover, 'Workflow operation already running or awaiting recovery. Read its status before retrying.', 409);
      // Serialize lock recovery itself: two recovery requests must never unlink a
      // newly acquired live lock after both observed the same dead owner.
      const recoveryPath = join(this.folder(id), 'recovery.lock');
      let recovery;
      try { recovery = await open(recoveryPath, 'wx', 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; throw Object.assign(new Error('Another recovery is running or its lock needs operator inspection.'), { status: 409 }); }
      try {
        let owner;
        try { owner = await readJson(path); } catch { /* Incomplete locks require operator inspection. */ }
        requireThat(owner && !this.ownerAlive(owner.pid), 'Workflow operation is still running or its lock ownership is unknown.', 409);
        await unlink(path);
        try { handle = await open(path, 'wx', 0o600); }
        catch (error) { if (error.code !== 'EEXIST') throw error; throw Object.assign(new Error('Another operation acquired this workflow.'), { status: 409 }); }
      } finally { await recovery.close(); await unlink(recoveryPath); }
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: stamp() })); return await execute(); }
    finally { await handle.close(); await unlink(path); }
  }
  async active(id) {
    try { const owner = await readJson(join(this.folder(id), 'operation.lock')); return Boolean(owner && this.ownerAlive(owner.pid)); }
    catch { return true; }
  }
  async create(value) {
    const input = workflowInput.parse(value), repo = parseRepository(input.repoUrl);
    const id = `wf_${hash(input.requestKey).slice(0, 20)}`, requestDigest = hash(input);
    const existing = await readJson(join(this.folder(id), 'workflow.json'));
    if (existing) {
      requireThat(existing.requestDigest === requestDigest, 'requestKey belongs to a different workflow brief.', 409);
      return this.view(existing);
    }
    return this.locked(id, async () => {
      const winner = await readJson(join(this.folder(id), 'workflow.json'));
      if (winner) {
        requireThat(winner.requestDigest === requestDigest, 'requestKey belongs to a different workflow brief.', 409);
        return this.view(winner);
      }
      const slug = repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 30);
      const record = {
        schemaVersion: 1, id, requestDigest, revision: 1,
        brief: { ...input, name: input.name || `app-${slug}` },
        status: 'planning', questions: [], blockers: [], timeline: [], mutations: {},
        createdAt: stamp(), updatedAt: stamp(),
      };
      await this.save(record, 'Workflow created. Repository and business inputs will be checked before a model call.');
      await this.prepare(record);
      return this.view(record);
    });
  }
  async prepare(record) {
    record.status = 'planning'; record.questions = []; record.blockers = [];
    await this.save(record, 'Checking this revision against the pinned source.');
    try {
      const input = record.brief;
      const inspection = await this.pipeline.inspect({
        repoUrl: input.repoUrl, ref: record.source?.commitSha || input.ref,
        ...(input.rootDirectory ? { rootDirectory: input.rootDirectory } : {}),
      }, { githubToken: await this.pipeline.token() });
      if (record.source?.commitSha) requireThat(inspection.source?.commitSha === record.source.commitSha, 'Inspection returned a different source commit. Create a new workflow for source changes.', 409);
      if (inspection.source?.commitSha) record.source = inspection.source;
      const recipe = buildRecipe(input, inspection);
      record.recipe = recipe;
      if (!input.hypothesis) record.questions.push({ id: 'hypothesis', kind: 'text', prompt: 'What do you want to learn from people trying this project?' });
      if (!input.audience) record.questions.push({ id: 'audience', kind: 'text', prompt: 'Who should try this project?' });
      for (const question of recipe.questions) {
        if (question.id === 'rootDirectory') record.questions.push({ ...question, kind: 'choice' });
        else if (['buildScript', 'lockfile'].includes(question.id)) {
          if (!record.questions.some((q) => q.id === 'allowRepairs')) record.questions.push({
            id: 'allowRepairs', kind: 'boolean', prompt: 'May LaunchLab add the missing Vite build script or npm lockfile in the isolated build copy?',
          });
        } else record.blockers.push({ code: question.id, message: question.prompt });
      }
      if (!record.source?.commitSha && !record.blockers.length) record.blockers.push({ code: 'source', message: 'Repository access and the source commit must be verified before planning.' });
      if (record.blockers.length || record.questions.length) {
        record.status = record.blockers.length ? 'blocked' : 'needs_input';
        await this.save(record, 'Returned questions or adapter blockers. No model request or deployment was made.');
        return;
      }
      const requestKey = `${record.id}_r${record.revision}`;
      const experimentBrief = experimentInput.parse({ ...input, requestKey, ref: record.source.commitSha });
      record.experimentId = `exp_${hash(requestKey).slice(0, 20)}`;
      await this.save(record, 'Preparing the measurement plan. A lost model response will not be retried automatically.');
      const experiment = await this.agent.plan(experimentBrief);
      await this.attach(record, experiment);
    } catch (error) {
      record.status = 'blocked'; record.blockers = [{ code: 'planning_failed', message: error.message }];
      await this.save(record, 'Planning stopped. Inspect the blocker before an explicit resume.');
    }
  }
  async attach(record, experiment) {
    if (experiment.status === 'planned' && experiment.deploymentId && experiment.planDigest) {
      requireThat(experiment.source?.commitSha === record.source?.commitSha && experiment.source?.repoUrl === record.source?.repoUrl, 'The measurement plan does not match this workflow’s pinned source.', 409);
      record.status = 'awaiting_approval'; record.planDigest = experiment.planDigest;
      record.deploymentId = experiment.deploymentId; record.questions = []; record.blockers = [];
      await this.save(record, 'Measurement plan is ready for review. Deployment requires this revision and exact plan digest.');
    } else {
      record.status = 'blocked';
      record.blockers = (experiment.blockers?.length ? experiment.blockers : ['Planning did not finish. Its model request may already have been billed.'])
        .map((message) => ({ code: 'experiment_planning', message }));
      await this.save(record, 'Experiment planning did not produce an approvable deployment.');
    }
  }
  newRevision(record) {
    record.history ||= [];
    record.history.push({ revision: record.revision, experimentId: record.experimentId || null, planDigest: record.planDigest || null });
    record.revision++;
    for (const key of ['experimentId', 'deploymentId', 'planDigest', 'approval']) delete record[key];
    record.questions = []; record.blockers = []; record.status = 'planning';
  }
  mutation(record, key, input) {
    const digest = hash(input), previous = Object.hasOwn(record.mutations, key) ? record.mutations[key] : null;
    if (previous) requireThat(previous.digest === digest, 'This mutation requestKey was already used with different input.', 409);
    return { digest, previous };
  }
  rememberMutation(record, key, digest) {
    // User-selected request keys are data, including JavaScript prototype names.
    Object.defineProperty(record.mutations, key, { value: { digest, revision: record.revision }, enumerable: true, writable: true, configurable: true });
  }
  async answer(id, value) {
    const input = workflowAnswer.parse(value);
    return this.locked(id, async () => {
      const record = await this.load(id), { digest, previous } = this.mutation(record, input.requestKey, { operation: 'answer', ...input });
      if (previous) return this.view(record);
      requireThat(record.revision === input.expectedRevision, 'Workflow revision changed. Read the current plan before answering.', 409);
      requireThat(!record.approval, 'Deployment has already been authorized. Create a new workflow to change its scope.', 409);
      requireThat(record.status !== 'planning', 'Planning was interrupted. Resume or inspect it before answering.', 409);
      const rootQuestion = record.questions.find((q) => q.id === 'rootDirectory');
      if (input.answers.rootDirectory && rootQuestion?.options) requireThat(rootQuestion.options.includes(input.answers.rootDirectory), 'Choose one of the inspected application folders.', 400);
      const brief = workflowInput.parse({ ...record.brief, ...input.answers });
      requireThat(hash(brief) !== hash(record.brief), 'Answers did not change the brief. Resolve the blocker or explicitly resume.', 409);
      record.brief = brief;
      this.newRevision(record);
      this.rememberMutation(record, input.requestKey, digest);
      await this.save(record, 'Answers recorded; the previous plan digest is no longer valid.');
      await this.prepare(record);
      return this.view(record);
    });
  }
  async start(id, value) {
    const input = workflowStart.parse(value);
    return this.locked(id, async () => {
      const record = await this.load(id);
      requireThat(input.expectedRevision === record.revision && input.planDigest === record.planDigest, 'Approval does not match the current revision and plan digest.', 409);
      if (record.approval) return this.view(record); // Never spawn another worker on a network retry.
      requireThat(record.status === 'awaiting_approval' && record.deploymentId, 'This workflow is not ready for deployment approval.', 409);
      record.approval = { at: stamp(), revision: record.revision, planDigest: record.planDigest };
      record.status = 'deploying';
      await this.save(record, 'Deployment approval recorded before dispatching the existing AWS worker.');
      try { await this.agent.start(record.experimentId, { planDigest: record.planDigest }); }
      catch (error) { record.status = 'blocked'; record.blockers = [{ code: 'dispatch_failed', message: error.message }]; await this.save(record, 'Worker dispatch is uncertain. Read progress before an explicit resume.'); }
      return this.view(record);
    });
  }
  async resume(id, value) {
    const input = workflowResume.parse(value);
    return this.locked(id, async () => {
      const record = await this.load(id), { digest, previous } = this.mutation(record, input.requestKey, { operation: 'resume', ...input });
      if (previous) return this.view(record);
      requireThat(input.expectedRevision === record.revision, 'Workflow revision changed. Read its current state before resuming.', 409);
      if (record.approval) {
        requireThat(!input.retryPlanning, 'An authorized deployment cannot be replanned. Create a new workflow.', 409);
        const deployment = await this.pipeline.get(record.deploymentId);
        requireThat(deployment.planDigest === record.approval.planDigest, 'The deployment no longer matches the approved plan.', 409);
        this.rememberMutation(record, input.requestKey, digest);
        await this.save(record, 'Explicit resume will reconcile the existing deployment; no new project is planned.');
        if (deployment.status !== 'ready') {
          try { await this.pipeline.start(record.deploymentId, { planDigest: record.approval.planDigest }); }
          catch (error) { record.status = 'blocked'; record.blockers = [{ code: 'dispatch_failed', message: error.message }]; await this.save(record, 'Resume could not dispatch the existing deployment.'); }
        }
        return this.view(record);
      }
      const experiment = await this.experiment(record);
      if (experiment?.status === 'planned') {
        this.rememberMutation(record, input.requestKey, digest);
        await this.attach(record, experiment);
        return this.view(record);
      }
      if (record.experimentId) {
        // Leave the old attempt intact. Only known-dead owners permit a new revision;
        // older empty locks remain an explicit operator recovery boundary.
        let owner;
        try { owner = await readJson(join(this.agent.folder(record.experimentId), 'planning.lock')); }
        catch { throw Object.assign(new Error('The experiment planning lock needs operator inspection before retrying. No model call was made.'), { status: 409 }); }
        requireThat(!owner || !this.ownerAlive(owner.pid), 'Experiment planning is still running. No competing model call was made.', 409);
        requireThat(input.retryPlanning, 'The previous model attempt may already have been billed. Set retryPlanning=true only to authorize a new planning attempt.', 409);
        this.newRevision(record);
      } else requireThat(['blocked', 'planning'].includes(record.status), 'Answer the returned questions before resuming.', 409);
      this.rememberMutation(record, input.requestKey, digest);
      await this.save(record, 'Explicit planning recovery recorded. Source stays pinned.');
      await this.prepare(record);
      return this.view(record);
    }, { recover: true });
  }
  async experiment(record) {
    if (!record.experimentId) return null;
    try { return await this.agent.get(record.experimentId); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async view(record) {
    const experiment = await this.experiment(record);
    const deployment = record.deploymentId ? await this.pipeline.get(record.deploymentId) : null;
    let status = record.status;
    if (record.approval && deployment?.status === 'ready') status = 'ready';
    else if (record.approval && deployment?.status === 'blocked') status = 'blocked';
    else if (record.approval && deploymentActive.has(deployment?.status)) status = 'deploying';
    else if (record.approval && deployment?.status === 'planned') status = 'needs_recovery';
    else if (status === 'planning' && !(await this.active(record.id))) status = 'needs_recovery';
    const base = `/api/agent/workflows/${record.id}`;
    let nextAction;
    const adapterBlocked = record.blockers.some((b) => ['framework', 'runtime', 'packageManager', 'lockfileConflict', 'managerConflict', 'packageManagerConflict', 'workspace', 'workspaceRoot'].includes(b.code));
    if (status === 'blocked' && adapterBlocked) nextAction = { type: 'resolve_blocker', message: 'Resolve the returned repository or adapter blockers. Answers cannot bypass unsupported runtimes; source changes require a new workflow.' };
    else if (status === 'needs_input' || (status === 'blocked' && record.questions.length)) nextAction = { type: 'answer', tool: 'launchlab_answer_workflow', method: 'POST', path: base + '/answers', expectedRevision: record.revision };
    else if (status === 'awaiting_approval') nextAction = { type: 'approve', tool: 'launchlab_start_workflow', method: 'POST', path: base + '/start', expectedRevision: record.revision, planDigest: record.planDigest, costAuthorizationRequired: true };
    else if (status === 'ready') nextAction = { type: 'read_results', tool: 'launchlab_workflow_report', method: 'GET', path: base + '/report', modelCall: false };
    else if (['blocked', 'needs_recovery'].includes(status)) nextAction = { type: 'review_and_resume', tool: 'launchlab_resume_workflow', method: 'POST', path: base + '/resume', expectedRevision: record.revision, newPlanningAttemptMayBeBillable: Boolean(record.experimentId && !record.approval) };
    else nextAction = { type: 'poll', tool: 'launchlab_get_workflow', method: 'GET', path: base, pollAfterSeconds: 5 };
    return {
      id: record.id, revision: record.revision, status, createdAt: record.createdAt, updatedAt: deployment?.updatedAt || record.updatedAt,
      brief: record.brief, source: record.source || null, questions: record.questions,
      blockers: deployment?.blocker ? [{ code: 'deployment', message: deployment.blocker.message }] : record.blockers,
      plan: record.planDigest && deployment && experiment ? { digest: record.planDigest, recipe: deployment.recipe, scope: deployment.scope, design: experiment.design, patches: experiment.previews, approved: Boolean(record.approval) } : null,
      experimentId: record.experimentId || null, deploymentId: record.deploymentId || null,
      progress: { phase: deployment?.status || record.status, timeline: [...record.timeline, ...(deployment?.timeline || [])] },
      delivery: status === 'ready' ? { website: deployment.links?.website, report: deployment.links?.report, accessRequired: true, verification: deployment.verification, sourceCommit: deployment.source.commitSha } : null,
      links: { status: base, report: base + '/report', analyze: base + '/analyze', access: base + '/access' },
      nextAction,
      limitations: ['Trusted single-operator API; not public multi-user hosting or an OKX AI listing.', 'Supported static frontends only. GitHub source is not modified.', 'Hosting, model usage, service billing and tester rewards are separate; no tester recruitment or payouts are performed.'],
    };
  }
  async get(id) { return this.view(await this.load(id)); }
  validateReport(workflow, filter, report) {
    requireThat(report.project === workflow.deploymentId && report.experimentId === workflow.experimentId && report.sourceCommit === workflow.source.commitSha
      && report.cohort === filter.cohort && String(report.days) === filter.days, 'Report evidence does not match this workflow, source revision and audience filter.', 502);
  }
  async report(id, value = {}) {
    const filter = workflowFilter.parse(value), workflow = await this.get(id);
    if (workflow.status !== 'ready') return { status: 'not_ready', workflow, report: null };
    const report = await this.agent.report(workflow.experimentId, filter);
    this.validateReport(workflow, filter, report);
    return { status: 'ready', workflowId: id, revision: workflow.revision, report };
  }
  async analyze(id, value = {}) {
    const filter = workflowFilter.parse(value), workflow = await this.get(id);
    requireThat(workflow.status === 'ready', 'The workflow must have a verified deployment before evidence analysis.', 409);
    return { workflowId: id, revision: workflow.revision, analysis: await this.agent.summarize(workflow.experimentId, filter, { validateReport: (report) => this.validateReport(workflow, filter, report) }) };
  }
  async access(id) {
    const workflow = await this.get(id);
    requireThat(workflow.status === 'ready', 'Preview access is available after deployment verification.', 409);
    const credentials = await readJson(join(this.pipeline.folder(workflow.deploymentId), 'founder-access.json'));
    requireThat(credentials?.url === workflow.delivery.website && credentials.username && credentials.password, 'Verified preview access is unavailable.', 409);
    // Explicit privileged retrieval only. Report/backend/cloud credentials stay server-side.
    return { workflowId: id, url: credentials.url, username: credentials.username, password: credentials.password, sensitive: true, handling: 'Share privately with authorized testers. Do not publish or include in logs.' };
  }
}
