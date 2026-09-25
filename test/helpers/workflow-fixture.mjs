import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentWorkflows } from '../../src/agent/workflows.mjs';
import { AgentExperiments } from '../../src/agent/experiments.mjs';
import { ManagedPipeline } from '../../src/managed/pipeline.mjs';
import { writeJson } from '../../src/managed/io.mjs';

export const repoUrl = 'https://github.com/example/proof-reps';
export const commit = 'a'.repeat(40);
export const brief = { requestKey: 'workflow-example-001', repoUrl, hypothesis: 'Will gym-goers try this store?', audience: 'Gym-goers' };
const design = {
  summary: 'Observe an example product action.',
  events: [{ id: 'try_product', label: 'Tried product', reason: 'Interest, not a purchase.' }],
  funnel: ['try_product'],
  questions: [{ id: 'first_impression', label: 'What was confusing?', kind: 'text', options: [] }],
  patches: [{ path: 'index.html', anchor: '<button>', placement: 'attribute', eventId: 'try_product' }],
  limitations: ['A click does not prove a sale.'],
};

export async function fixture(t, { multiRoot = false, unsupported = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'launchlab-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'hosting.json');
  await writeJson(configPath, { profile: 'fixture', region: 'ap-southeast-1', account: '123456789012' });
  const inspections = [], starts = [], reports = [];
  const pipeline = new ManagedPipeline({ directory: join(directory, 'managed'), experimentDirectory: join(directory, 'experiments'), configPath,
    inspect: async (input) => {
      inspections.push(input);
      const source = { repoUrl, commitSha: commit, requestedRef: input.ref };
      if (multiRoot && !input.rootDirectory) return { source, questions: [{ id: 'rootDirectory', kind: 'choice', prompt: 'Which application?', options: ['apps/store', 'apps/admin'] }], detected: null };
      return { source, questions: [], detected: { framework: unsupported ? 'nextjs' : 'static', rootDirectory: input.rootDirectory || '.', environmentKeys: [], lockfiles: [], packageManager: null, hasBuildScript: false } };
    },
  });
  pipeline.token = async () => undefined;
  const client = {
    calls: [], status: () => ({ configured: true, provider: 'fixture' }),
    async generate(request) {
      this.calls.push(request.name);
      return { receipt: { provider: 'fixture' }, value: request.name === 'launchlab_experiment' ? structuredClone(design) : {
        observations: [{ text: 'One internal test session.', evidenceIds: ['sessions'] }],
        reported: [], suggestions: [{ text: 'An internal fixture suggestion.', evidenceIds: ['sessions'] }], limitations: ['Fixture QA only.'],
      } };
    },
  };
  const agent = new AgentExperiments({ pipeline, client, loadSource: async (_input, _inspection, folder) => {
    await mkdir(join(folder, 'source'), { recursive: true });
    await writeFile(join(folder, 'source/index.html'), '<html><head></head><body><button>Try product</button></body></html>');
  } });
  async function complete(id) {
    const run = await pipeline.get(id);
    run.status = 'ready';
    run.links = { website: 'https://preview.example.test', report: 'https://preview.example.test/results', credentialsPath: '/private/not-in-workflow.json' };
    run.verification = { at: 'fixture', browserInteractionTested: false };
    await writeJson(join(pipeline.folder(id), 'founder-access.json'), { url: run.links.website, username: 'fixture-user', password: 'fixture-preview-password', reportKey: 'fixture-report-secret' });
    await pipeline.save(run, 'Fixture deployment completed; no AWS resources created.');
    return run;
  }
  pipeline.start = async (id, input) => { starts.push(id); await pipeline.authorize(id, input); return complete(id); };
  pipeline.report = async (id, filter) => {
    reports.push({ id, filter });
    const run = await pipeline.get(id);
    return { project: id, experimentId: run.input.experimentId, sourceCommit: run.source.commitSha, cohort: filter.cohort, days: Number(filter.days), sessions: filter.cohort === 'test' ? 1 : 0, responses: 0, hypothesis: run.input.hypothesis, eventCounts: [], comments: [], limitations: ['Fixture QA only.'] };
  };
  const workflows = new AgentWorkflows({ agent });
  return { directory, pipeline, agent, client, workflows, inspections, starts, reports, complete };
}
