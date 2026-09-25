import { parseArgs } from 'node:util';
import { ManagedPipeline } from '../src/managed/pipeline.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  name: { type: 'string' }, 'request-key': { type: 'string' }, hypothesis: { type: 'string' },
  ref: { type: 'string' }, root: { type: 'string' }, output: { type: 'string' }, 'goal-event': { type: 'string' },
  repair: { type: 'boolean', default: false }, 'refresh-build-packages': { type: 'boolean', default: false },
  execute: { type: 'boolean', default: false }, resume: { type: 'string' }, status: { type: 'string' }, report: { type: 'string' },
  data: { type: 'string' }, config: { type: 'string' }, node: { type: 'string' },
} });
const pipeline = new ManagedPipeline({ ...(values.data ? { directory: values.data } : {}), ...(values.config ? { configPath: values.config } : {}) });
pipeline.onProgress = (value) => console.error(JSON.stringify(value));
try {
  if (values.status) console.log(JSON.stringify(await pipeline.get(values.status), null, 2));
  else if (values.report) console.log(JSON.stringify(await pipeline.report(values.report), null, 2));
  else if (values.resume) {
    const run = await pipeline.execute(values.resume); console.log(JSON.stringify(run, null, 2));
    if (run.status === 'blocked') process.exitCode = 1;
  } else {
    const plan = await pipeline.plan({ repoUrl: positionals[0], name: values.name, requestKey: values['request-key'], hypothesis: values.hypothesis,
      ...(values.ref ? { ref: values.ref } : {}), ...(values.root ? { rootDirectory: values.root } : {}), ...(values.output ? { outputDirectory: values.output } : {}),
      ...(values['goal-event'] ? { goalEvent: values['goal-event'] } : {}), ...(values.node ? { nodeMajor: values.node } : {}),
      allowRepairs: values.repair, refreshBuildPackages: values['refresh-build-packages'],
    });
    if (values.execute && plan.status !== 'needs_input') {
      await pipeline.authorize(plan.id, { planDigest: plan.planDigest });
      const result = await pipeline.execute(plan.id); console.log(JSON.stringify(result, null, 2));
      if (result.status === 'blocked') process.exitCode = 1;
    } else console.log(JSON.stringify(plan, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
