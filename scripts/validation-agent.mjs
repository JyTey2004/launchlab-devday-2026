import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { ManagedPipeline } from '../src/managed/pipeline.mjs';
import { AgentExperiments } from '../src/agent/experiments.mjs';
const { values } = parseArgs({ options: { brief: { type: 'string' }, status: { type: 'string' }, deploy: { type: 'string' }, digest: { type: 'string' }, report: { type: 'string' }, analyze: { type: 'string' }, cohort: { type: 'string', default: 'organic' }, days: { type: 'string', default: '7' } } });
const pipeline = new ManagedPipeline(), agent = new AgentExperiments({ pipeline });
try {
  let result;
  if (values.brief) result = await agent.plan(JSON.parse(await readFile(values.brief, 'utf8')));
  else if (values.status) result = await agent.progress(values.status);
  else if (values.deploy) {
    const experiment = await agent.get(values.deploy);
    if (!values.digest || values.digest !== experiment.planDigest) throw new Error('Pass --digest with the exact reviewed planDigest to deploy.');
    await pipeline.authorize(experiment.deploymentId, { planDigest: values.digest });
    pipeline.onProgress = (value) => console.error(JSON.stringify(value));
    result = await pipeline.execute(experiment.deploymentId);
  } else if (values.report) result = await agent.report(values.report, { cohort: values.cohort, days: values.days });
  else if (values.analyze) result = await agent.summarize(values.analyze, { cohort: values.cohort, days: values.days });
  else result = agent.status();
  console.log(JSON.stringify(result, null, 2));
  if (['blocked','needs_input'].includes(result.status)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
