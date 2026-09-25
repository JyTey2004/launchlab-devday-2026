import { parseArgs } from 'node:util';
import { inspectDeployment } from '../src/deployment-preflight.mjs';

const help = `Usage: npm run inspect:repo -- <https://github.com/owner/repo> [--ref <branch-or-sha>] [--root <folder>] [--json]

Reads GitHub metadata and selected configuration, then proposes a deployment recipe.
Does not clone, install, build, deploy, or accept credentials as arguments.
For private repos, configure LAUNCHLAB_GITHUB_TOKEN in the operator environment.
Use --ref with the returned commit SHA when answering a folder-selection question.`;

try {
  const { values, positionals } = parseArgs({
    options: {
      ref: { type: 'string' },
      root: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1) throw new Error(help);
    const result = await inspectDeployment({
      repoUrl: positionals[0],
      ...(values.ref ? { ref: values.ref } : {}),
      ...(values.root ? { rootDirectory: values.root } : {}),
    });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      // Keep terminal control sequences in untrusted repository metadata inert.
      const print = (value = '') =>
        console.log(String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' '));
      print('LaunchLab · repository inspection');
      print(`Repository: ${result.source.repoUrl}`);
      print(`Commit: ${result.source.commitSha || 'access not verified'}`);
      print(`Status: ${result.status}`);
      if (result.detected) {
        const d = result.detected;
        print(
          `Framework: ${d.framework}${d.libraries.length ? ` (${d.libraries.join(', ')})` : ''}`,
        );
        print(`App folder: ${d.rootDirectory}`);
        print(
          `Package manager: ${d.packageManager || 'unresolved'}${d.packageManagerVersion ? ` ${d.packageManagerVersion}` : ''}`,
        );
        const plan = result.deploymentPlan;
        print(`Hosting candidate: ${plan.provider || 'requires adapter review'}`);
        print(
          `Install: ${plan.install.command || 'none or needs configuration'} (folder: ${plan.install.workingDirectory})`,
        );
        print(
          `Build: ${plan.build.command || 'none or needs configuration'} (folder: ${plan.build.workingDirectory})`,
        );
        print(`Output: ${plan.output.directory || 'determined by provider/runtime'} (unverified)`);
        if (d.environmentKeys.length) print(`Environment names: ${d.environmentKeys.join(', ')}`);
        print('Evidence:');
        for (const item of result.evidence) print(`  ${item.path}: ${item.signal}`);
      }
      if (result.questions.length) {
        print('Questions for the founder or calling agent:');
        for (const item of result.questions) {
          print(`  [${item.id}] ${item.prompt}`);
          if (item.options) print(`    Options: ${item.options.join(', ')}`);
        }
      }
      print(result.nextAction);
      print('Inspection only. No build, deployment, payment or ownership verification performed.');
    }
  }
} catch (error) {
  console.error(
    error.name === 'ZodError'
      ? 'Invalid inspection input. Use --help for accepted arguments.'
      : error.code?.startsWith('ERR_PARSE_ARGS')
        ? 'Invalid arguments. Use --help; credentials are not accepted as arguments.'
        : error.message,
  );
  process.exitCode = 1;
}
