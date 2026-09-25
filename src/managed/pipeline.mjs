import { mkdir, readFile, writeFile, readdir, cp, open, unlink, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inspectDeployment } from '../deployment-preflight.mjs';
import { requireThat } from '../store.mjs';
import { managedInput, confirmation, deploymentId, validId, buildRecipe, hash } from './contracts.mjs';
import { Aws, command, readJson, writeJson, sleep, awsOptions } from './io.mjs';
import { githubArchive } from './github-archive.mjs';
import { infrastructure, securityHeaders } from './infrastructure.mjs';
import { validateDesign } from '../agent/schemas.mjs';
import { publicExperiment } from './experiment-config.mjs';
import { verifyInstrumentationBuild } from './instrument-patch.mjs';
import { verifyObservationPreflight } from './verify-observation.mjs';

const MODULE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const stamp = () => new Date().toISOString();
const permittedUrl = (value, suffix) => { const u = new URL(value); requireThat(u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.endsWith(suffix), 'Unexpected hosting URL.', 502); return u.origin; };

export class ManagedPipeline {
  constructor({ directory = process.env.LAUNCHLAB_MANAGED_DATA || join(ROOT, '.data/managed'), configPath = process.env.LAUNCHLAB_MANAGED_CONFIG || join(ROOT, 'deploy/managed-hosting.json'), experimentDirectory = process.env.LAUNCHLAB_EXPERIMENT_DATA || join(ROOT, '.data/experiments'), inspect = inspectDeployment } = {}) {
    Object.assign(this, { directory: resolve(directory), configPath: resolve(configPath), experimentDirectory: resolve(experimentDirectory), inspect });
  }
  folder(id) { requireThat(validId(id), 'Invalid deployment identifier.'); return join(this.directory, id); }
  async get(id) {
    const run = await readJson(join(this.folder(id), 'run.json'));
    requireThat(run, 'Deployment not found.', 404);
    return run;
  }
  async save(run, message) {
    run.updatedAt = stamp();
    if (message) run.timeline.push({ at: run.updatedAt, status: run.status, message });
    await writeJson(join(this.folder(run.id), 'run.json'), run);
    if (message && this.onProgress) this.onProgress({ id: run.id, status: run.status, message });
  }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const ids = (await readdir(this.directory)).filter(validId);
    return Promise.all(ids.map((id) => this.get(id)));
  }
  async token() {
    if (process.env.LAUNCHLAB_GITHUB_TOKEN) return process.env.LAUNCHLAB_GITHUB_TOKEN;
    try { return (await command('gh', ['auth', 'token'])).stdout.trim(); }
    catch { return undefined; }
  }
  async plan(value) {
    const input = managedInput.parse(value), id = deploymentId(input.requestKey), requestDigest = hash(input);
    const folder = this.folder(id); await mkdir(folder, { recursive: true, mode: 0o700 });
    const previous = await readJson(join(folder, 'run.json'));
    if (previous) { requireThat(previous.requestDigest === requestDigest, 'requestKey already belongs to another deployment brief.', 409); return previous; }
    const config = await readJson(this.configPath);
    requireThat((config?.profile || config?.credentialSource === 'instance-role') && /^[0-9]{12}$/.test(config.account || '') && /^[a-z]{2}-[a-z]+-\d$/.test(config.region || ''), 'Configure a LaunchLab AWS hosting account first.', 409);
    const inspection = await this.inspect({ repoUrl: input.repoUrl, ref: input.ref, ...(input.rootDirectory ? { rootDirectory: input.rootDirectory } : {}) }, { githubToken: await this.token() });
    const recipe = buildRecipe(input, inspection);
    let instrumentation;
    if (input.experimentId) {
      instrumentation = await readJson(join(this.experimentDirectory, input.experimentId, 'instrumentation.json'));
      requireThat(instrumentation && hash(instrumentation) === input.experimentDigest, 'Experiment artifact does not match its digest.', 409);
      validateDesign(instrumentation.design);
      requireThat(instrumentation.id === input.experimentId && instrumentation.source.commitSha === inspection.source?.commitSha && instrumentation.source.repoUrl === inspection.source?.repoUrl && instrumentation.rootDirectory === recipe.rootDirectory, 'Experiment instrumentation belongs to a different source revision.', 409);
    }
    const run = { id, requestDigest, input, source: inspection.source, recipe, hosting: { profile: config.profile, region: config.region, account: config.account, ...(config.cloudFormationRoleArn ? { cloudFormationRoleArn: config.cloudFormationRoleArn, roleBoundaryArn: config.roleBoundaryArn } : {}) },
      resourceName: `${config.resourcePrefix || 'll'}-${input.name}-${id.slice(-8)}`, status: recipe.questions.length ? 'needs_input' : 'planned',
      questions: recipe.questions, createdAt: stamp(), updatedAt: stamp(), timeline: [],
      scope: { visibility: 'password-protected', costs: 'AWS usage billed to the configured LaunchLab account; no end-user payment is collected.',
        expiration: 'Hosting continues until explicitly removed; no hosting subscription or automatic expiry is claimed.',
        maximumBuildMinutes: 10, attempts: 1, frameworkSupport: 'npm-based static Vite frontends and plain static sites; no SSR or server secrets.',
        sourceChanges: 'Disposable build copy only. Original GitHub repository is not modified.',
        results: 'Opt-in sessions, marked primary actions and voluntary feedback. No verified sales, identity or payouts.' },
    };
    if (instrumentation) run.instrumentation = instrumentation;
    run.planDigest = hash({ input, source: run.source, recipe, hosting: run.hosting, scope: run.scope, ...(instrumentation ? { instrumentation } : {}) });
    run.timeline.push({ at: stamp(), status: run.status, message: 'Repository inspected and commit pinned. No cloud resources or builds created.' });
    try { await writeFile(join(folder, 'run.json'), JSON.stringify(run, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; const winner = await this.get(id); requireThat(winner.requestDigest === requestDigest, 'requestKey conflict.', 409); return winner; }
    return run;
  }
  async authorize(id, value) {
    const { planDigest } = confirmation.parse(value), run = await this.get(id);
    requireThat(run.planDigest === planDigest, 'Plan digest does not match the authorized deployment.', 409);
    requireThat(run.status !== 'needs_input', 'Resolve the returned questions and use a new requestKey.', 409);
    if (run.status === 'planned') { run.authorizedAt = stamp(); run.status = 'queued'; await this.save(run, 'Confirmed deployment, AWS cost scope and bounded repair policy.'); }
    return run;
  }
  async start(id, value) {
    const run = await this.authorize(id, value);
    if (run.status === 'ready') return run;
    const folder = this.folder(id);
    const log = await open(join(folder, 'worker.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(ROOT, 'scripts/managed-deploy.mjs'), '--resume', id, '--data', this.directory, '--config', this.configPath], { cwd: ROOT, env: { ...process.env, LAUNCHLAB_EXPERIMENT_DATA: this.experimentDirectory }, detached: true, stdio: ['ignore', log.fd, log.fd] });
    child.unref(); await log.close();
    return { ...run, nextAction: `Poll /api/managed-deployments/${id}.` };
  }
  async credentials(run) {
    const file = join(this.folder(run.id), 'access.json');
    let secrets = await readJson(file);
    if (!secrets) {
      secrets = { username: 'launchlab', password: randomBytes(24).toString('base64url'), reportKey: randomBytes(32).toString('hex'), sessionSecret: randomBytes(32).toString('hex') };
      await writeJson(file, secrets);
    }
    return secrets;
  }
  async execute(id) {
    const folder = this.folder(id), lockPath = join(folder, 'worker.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = await readJson(lockPath); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (!owner?.pid) {
        // A new worker may not have written its PID yet. Recover only an old empty lock.
        if (Date.now() - (await stat(lockPath)).mtimeMs < 30000) return this.get(id);
      } else {
        try { process.kill(owner.pid, 0); return this.get(id); }
        catch (check) { if (check.code !== 'ESRCH') throw check; }
      }
      await unlink(lockPath); lock = await open(lockPath, 'wx', 0o600);
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: stamp() }));
    let run = await this.get(id);
    try {
      requireThat(run.authorizedAt && run.status !== 'needs_input', 'This deployment has not been authorized.', 409);
      if (run.status === 'ready') return run;
      const configured = await readJson(this.configPath);
      requireThat(hash(run.hosting) === hash({ profile: configured.profile, region: configured.region, account: configured.account, ...(configured.cloudFormationRoleArn ? { cloudFormationRoleArn: configured.cloudFormationRoleArn, roleBoundaryArn: configured.roleBoundaryArn } : {}) }), 'Hosting account changed after the plan was confirmed.', 409);
      const aws = new Aws({ ...run.hosting, directory: join(folder, 'requests') });
      await aws.verify();
      const secrets = await this.credentials(run);
      if (!run.resources) {
        const existing = (await this.list()).filter((r) => r.id !== run.id && r.resources);
        requireThat(existing.length < (configured.maxActiveDeployments || 5), 'LaunchLab deployment limit reached. Review existing environments before adding another.', 409);
        run.status = 'provisioning'; await this.save(run, 'Preparing a dedicated private preview, build worker and experiment backend.');
        const template = infrastructure(run, await readFile(join(MODULE, 'collector.py'), 'utf8'));
        let stack;
        try { stack = (await aws.call('cloudformation', 'describe-stacks', { StackName: run.resourceName })).Stacks[0]; }
        catch (error) { if (!error.detail?.includes('does not exist')) throw error; }
        if (!stack) {
          await aws.call('cloudformation', 'create-stack', { StackName: run.resourceName, TemplateBody: JSON.stringify(template), Capabilities: ['CAPABILITY_IAM'],
            ...(run.hosting.cloudFormationRoleArn ? { RoleARN: run.hosting.cloudFormationRoleArn } : {}),
            Parameters: [{ ParameterKey: 'PreviewPassword', ParameterValue: secrets.password }, { ParameterKey: 'ReportTokenHash', ParameterValue: hash(secrets.reportKey) }, { ParameterKey: 'SessionSecret', ParameterValue: secrets.sessionSecret }],
            Tags: [{ Key: 'LaunchLabDeployment', Value: run.id }],
          });
        } else requireThat(stack.Tags?.some((t) => t.Key === 'LaunchLabDeployment' && t.Value === run.id), 'Cloud stack identity does not belong to this deployment.', 409);
        for (let attempt = 0; attempt < 80; attempt++) {
          stack = (await aws.call('cloudformation', 'describe-stacks', { StackName: run.resourceName })).Stacks[0];
          if (stack.StackStatus === 'CREATE_COMPLETE') break;
          requireThat(!/FAILED|ROLLBACK/.test(stack.StackStatus), 'Cloud provisioning failed. Inspect this deployment’s CloudFormation events; existing projects were not changed.', 502);
          await sleep(10000);
        }
        requireThat(stack.StackStatus === 'CREATE_COMPLETE', 'Provisioning is still running. Resume this deployment.', 504);
        run.resources = Object.fromEntries(stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]));
        run.resources.Url = permittedUrl(run.resources.Url, '.amplifyapp.com');
        run.resources.ApiBase = permittedUrl(run.resources.ApiBase, `.execute-api.${run.hosting.region}.amazonaws.com`);
        await this.save(run, 'Dedicated AWS resources are ready.');
      }
      if (!run.sourceArchiveHash) {
        run.status = 'preparing_source'; await this.save(run, 'Fetching only the pinned repository revision; no repository code runs on the operator host.');
        await writeFile(join(folder, 'repository.zip'), await githubArchive(run.input.repoUrl, run.source.commitSha, await this.token()), { mode: 0o600 });
        const source = join(folder, 'source');
        await command('python3', [join(MODULE, 'archive.py'), 'source', join(folder, 'repository.zip'), join(source, 'app'), run.recipe.rootDirectory]);
        await mkdir(join(source, '.launchlab'), { recursive: true });
        for (const file of ['build-worker.mjs', 'build-doctor.mjs', 'instrument-patch.mjs']) await cp(join(MODULE, file), join(source, '.launchlab', file));
        await writeJson(join(source, '.launchlab/job.json'), { commitSha: run.source.commitSha, recipe: run.recipe, ...(run.instrumentation ? { instrumentation: run.instrumentation } : {}) });
        await command('python3', [join(MODULE, 'archive.py'), 'pack', source, join(folder, 'source.zip')]);
        await command('aws', ['s3api', 'put-object', '--bucket', run.resources.Bucket, '--key', 'source.zip', '--body', join(folder, 'source.zip'), '--server-side-encryption', 'AES256', ...awsOptions(run.hosting)]);
        run.sourceArchiveHash = hash(await readFile(join(folder, 'source.zip')));
        await this.save(run, 'Pinned source package uploaded to this project’s private build bucket.');
      }
      if (!run.buildId) {
        const ids = (await aws.call('codebuild', 'list-builds-for-project', { projectName: run.resources.Builder, sortOrder: 'DESCENDING' })).ids;
        if (ids.length) run.buildId = ids[0];
        else {
          run.status = 'building'; await this.save(run, 'Building in AWS. Only explicitly allowed package and build-command repairs may be applied.');
          const result = await aws.call('codebuild', 'start-build', { projectName: run.resources.Builder, idempotencyToken: run.id, timeoutInMinutesOverride: 10, queuedTimeoutInMinutesOverride: 5 });
          run.buildId = result.build.id;
        }
        await this.save(run);
      }
      let build;
      for (let attempt = 0; attempt < 100; attempt++) {
        build = (await aws.call('codebuild', 'batch-get-builds', { ids: [run.buildId] })).builds[0];
        requireThat(build, 'Build evidence was not found.', 502);
        if (build.buildStatus !== 'IN_PROGRESS') break;
        await sleep(10000);
      }
      requireThat(build.buildStatus === 'SUCCEEDED', `Build ${build.buildStatus}. Inspect the private CodeBuild log. Source fixes or a new build attempt require a new requestKey.`, 422);
      run.status = 'packaging'; run.buildLog = build.logs?.deepLink || null; await this.save(run, 'Isolated build passed. Validating the artifact and adding project-specific observation.');
      const artifactKey = build.artifacts.location.replace(`arn:aws:s3:::${run.resources.Bucket}/`, '');
      requireThat(!artifactKey.includes(':') && artifactKey.startsWith('outputs/'), 'Unexpected build artifact location.', 502);
      // get-object takes its destination as a positional argument, so use the dedicated bounded command.
      await command('aws', ['s3api', 'get-object', '--bucket', run.resources.Bucket, '--key', artifactKey, join(folder, 'build.zip'), ...awsOptions(run.hosting)]);
      await command('python3', [join(MODULE, 'archive.py'), 'artifact', join(folder, 'build.zip'), join(folder, 'artifact')]);
      run.buildReport = await readJson(join(folder, 'artifact/evidence/build-report.json'));
      requireThat(run.buildReport?.status === 'passed' && run.buildReport.sourceCommit === run.source.commitSha, 'Build report does not match the pinned source.', 502);
      if (run.instrumentation) verifyInstrumentationBuild(run.instrumentation, run.buildReport.instrumentation);
      const site = join(folder, 'artifact/site');
      let marker = false;
      async function attach(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const file = join(path, entry.name);
          if (entry.isDirectory()) { if (entry.name !== '__launchlab') await attach(file); continue; }
          if (/\.(html|js|mjs)$/.test(file)) {
            const content = await readFile(file, 'utf8');
            if (content.includes('data-launchlab-event') && content.includes(run.input.goalEvent)) marker = true;
            if (file.endsWith('.html')) {
              requireThat(!/http-equiv\s*=\s*["']Content-Security-Policy/i.test(content), 'This HTML defines its own CSP. Align it with the observation assets before deployment.', 422);
              const injection = '<script type="module" src="/__launchlab/widget.js"></script>';
              const sdk = run.instrumentation ? '<script src="/__launchlab/sdk.js"></script>' : '';
              const withSdk = sdk ? (/<head(?:\s[^>]*)?>/i.test(content) ? content.replace(/<head(?:\s[^>]*)?>/i, (tag) => tag + sdk) : sdk + content) : content;
              await writeFile(file, /<\/body>/i.test(withSdk) ? withSdk.replace(/<\/body>/i, injection + '</body>') : withSdk + injection);
            }
          }
        }
      }
      await attach(site);
      await cp(join(MODULE, 'assets'), join(site, '__launchlab'), { recursive: true });
      await writeJson(join(site, '__launchlab/config.json'), { project: run.id, name: run.input.name, hypothesis: run.input.hypothesis, goalEvent: run.input.goalEvent, goalMarkerFound: marker, apiBase: run.resources.ApiBase,
        ...(run.instrumentation ? { experiment: publicExperiment(run) } : {}) });
      run.observation = { goalMarkerFound: marker, reportUrl: `${run.resources.Url}/__launchlab/results.html` };
      await command('python3', [join(MODULE, 'archive.py'), 'pack', site, join(folder, 'release.zip')]);
      run.artifactSha256 = hash(await readFile(join(folder, 'release.zip')));
      await aws.call('amplify', 'update-app', { appId: run.resources.AppId, customHeaders: securityHeaders(run.resources.ApiBase) });
      if (!run.amplifyJobId) {
        run.status = 'publishing'; await this.save(run, 'Publishing the validated artifact to this project’s password-protected preview.');
        const deployment = await aws.call('amplify', 'create-deployment', { appId: run.resources.AppId, branchName: 'preview' });
        run.amplifyJobId = deployment.jobId; await this.save(run);
        const response = await fetch(deployment.zipUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: await readFile(join(folder, 'release.zip')), signal: AbortSignal.timeout(60000) });
        requireThat(response.ok, 'Artifact upload failed. Resume requires inspecting the pending Amplify job.', 502);
        await aws.call('amplify', 'start-deployment', { appId: run.resources.AppId, branchName: 'preview', jobId: run.amplifyJobId });
      }
      let job;
      for (let attempt = 0; attempt < 60; attempt++) {
        job = (await aws.call('amplify', 'get-job', { appId: run.resources.AppId, branchName: 'preview', jobId: run.amplifyJobId })).job.summary;
        if (['SUCCEED', 'FAILED', 'CANCELLED'].includes(job.status)) break;
        await sleep(5000);
      }
      requireThat(job.status === 'SUCCEED', `Amplify deployment is ${job.status}. Inspect or resume the existing job; do not create another project.`, 502);
      run.status = 'verifying'; await this.save(run, 'Verifying HTTPS assets, privacy and the project’s feedback service.');
      const basic = 'Basic ' + Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64');
      let verifiedFiles = 0;
      async function verify(path, prefix = '') {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.isDirectory()) { await verify(join(path, entry.name), prefix + entry.name + '/'); continue; }
          const rel = prefix + entry.name;
          const response = await fetch(run.resources.Url + '/' + rel.split('/').map(encodeURIComponent).join('/'), { headers: { Authorization: basic, 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
          requireThat(response.ok && hash(Buffer.from(await response.arrayBuffer())) === hash(await readFile(join(path, entry.name))), 'Hosted asset verification failed: ' + rel, 502);
          if (rel.endsWith('.html')) requireThat(response.headers.get('content-security-policy')?.includes(run.resources.ApiBase), 'Observation API is missing from the hosting policy.', 502);
          verifiedFiles++;
        }
      }
      await verify(site);
      requireThat((await fetch(run.resources.Url, { redirect: 'error' })).status === 401, 'Preview access protection did not verify.', 502);
      requireThat((await fetch(run.resources.ApiBase + '/health')).ok, 'Observation backend is unavailable.', 502);
      await verifyObservationPreflight(run.resources.ApiBase, run.resources.Url);
      requireThat((await fetch(run.resources.ApiBase + '/report')).status === 401, 'Report access protection did not verify.', 502);
      const reportResponse = await fetch(run.resources.ApiBase + '/report', { headers: { Authorization: 'Bearer ' + secrets.reportKey } });
      requireThat(reportResponse.ok && (await reportResponse.json()).project === run.id, 'Report belongs to the wrong project or is unavailable.', 502);
      await writeJson(join(folder, 'founder-access.json'), { url: run.resources.Url, username: secrets.username, password: secrets.password, reportUrl: run.observation.reportUrl, reportKey: secrets.reportKey });
      run.links = { website: run.resources.Url, report: run.observation.reportUrl, credentialsPath: join(folder, 'founder-access.json'), packagePatchPath: run.buildReport.changes.length ? join(folder, 'artifact/evidence/package.patch') : null };
      run.verification = { at: stamp(), verifiedFiles, anonymousStatus: 401, reportAnonymousStatus: 401, reportProjectMatched: true, browserPreflightVerified: true, browserInteractionTested: false };
      run.status = 'ready'; run.blocker = null; await this.save(run, 'Deployment verified. Share its preview access with testers; read its private results through LaunchLab.');
      return run;
    } catch (error) {
      run.status = 'blocked'; run.blocker = { message: error.message, at: stamp(), nextAction: 'Inspect the deployment evidence. Resume after an infrastructure issue; source or plan changes require a new requestKey.' };
      await this.save(run, error.message); return run;
    } finally { await lock.close(); await unlink(lockPath); }
  }
  async report(id, { cohort = 'organic', days = '7' } = {}) {
    requireThat(['organic', 'incentivized', 'agent', 'test'].includes(cohort) && ['7', '30'].includes(String(days)), 'Invalid report filter.');
    const run = await this.get(id); requireThat(run.status === 'ready', 'Deployment is not ready.', 409);
    const secrets = await this.credentials(run);
    const response = await fetch(`${run.resources.ApiBase}/report?cohort=${cohort}&days=${days}`, { headers: { Authorization: 'Bearer ' + secrets.reportKey }, signal: AbortSignal.timeout(25000) });
    requireThat(response.ok, 'The project report is temporarily unavailable.', 502);
    return response.json();
  }
}
