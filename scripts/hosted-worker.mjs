import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Resolve only the model configuration from the instance role, without placing
// key material in command arguments, service logs or the release archive.
if (process.env.LAUNCHLAB_MODEL_SECRET_ARN) {
  try {
    const { stdout } = await promisify(execFile)('aws', ['secretsmanager', 'get-secret-value', '--secret-id', process.env.LAUNCHLAB_MODEL_SECRET_ARN, '--region', process.env.AWS_REGION, '--output', 'json'], { maxBuffer: 200000 });
    const config = JSON.parse(JSON.parse(stdout).SecretString);
    if (typeof config.OPENAI_API_KEY !== 'string' || !config.OPENAI_API_KEY) throw new Error();
    process.env.OPENAI_API_KEY = config.OPENAI_API_KEY;
    if (config.LAUNCHLAB_OPENAI_MODEL) process.env.LAUNCHLAB_OPENAI_MODEL = config.LAUNCHLAB_OPENAI_MODEL;
  } catch { throw new Error('Hosted model configuration could not load. Check the instance role, runtime CLI and private secret configuration.'); }
}
process.argv[2] = 'worker';
await import('../src/hosted/server.mjs');
