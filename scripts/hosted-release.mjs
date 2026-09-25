import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Aws, command, writeJson } from '../src/managed/io.mjs';
import { hash } from '../src/managed/contracts.mjs';

process.umask(0o077);
const directory = resolve('.data/hosted-operator'); await mkdir(directory, { recursive: true, mode: 0o700 });
const config = { profile: 'stardive', region: 'ap-southeast-1', account: '113978311640', directory };
const aws = new Aws(config); await aws.verify();
const stack = (await aws.call('cloudformation', 'describe-stacks', { StackName: 'launchlab-hosted-demo' })).Stacks[0];
if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error('Wait for the hosting stack to finish.');
const output = Object.fromEntries(stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]));
const domain = `launchlab-${output.PublicIp.replaceAll('.', '-')}.sslip.io`;
const env = parseEnv(await readFile('.env', 'utf8'));
if (!env.OPENAI_API_KEY) throw new Error('The existing model key is missing.');
// Aws.call writes a mode-0600 temporary JSON request and removes it afterwards.
await aws.call('secretsmanager', 'put-secret-value', { SecretId: output.ModelSecretArn,
  SecretString: JSON.stringify({ OPENAI_API_KEY: env.OPENAI_API_KEY, LAUNCHLAB_OPENAI_MODEL: env.LAUNCHLAB_OPENAI_MODEL }) });
const archive = join(directory, 'release.tar.gz');
await command('tar', ['--no-xattrs', '-czf', archive, 'src', 'scripts', 'package.json', 'package-lock.json', 'deploy/hosted-bootstrap.sh'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
const digest = hash(await readFile(archive)), key = `releases/${digest}.tar.gz`;
await command('aws', ['s3api', 'put-object', '--bucket', output.ReleaseBucket, '--key', key, '--body', archive, '--server-side-encryption', 'AES256', '--profile', config.profile, '--region', config.region]);
const quote = (v) => "'" + String(v).replaceAll("'", "'\\''") + "'";
const bootstrap = await readFile('deploy/hosted-bootstrap.sh', 'utf8');
const commands = [
  'set -eu',
  `printf %s ${quote(Buffer.from(bootstrap).toString('base64'))} | base64 -d > /tmp/launchlab-bootstrap.sh`,
  'bash /tmp/launchlab-bootstrap.sh ' + [output.ReleaseBucket, key, digest, domain, output.ModelSecretArn, output.CloudFormationRoleArn, output.RoleBoundaryArn, config.region, config.account].map(quote).join(' '),
];
const invocation = await aws.call('ssm', 'send-command', { InstanceIds: [output.InstanceId], DocumentName: 'AWS-RunShellScript', Comment: 'Install verified LaunchLab workflow service release', TimeoutSeconds: 900, Parameters: { commands, executionTimeout: ['900'] } });
const record = { at: new Date().toISOString(), stack: stack.StackName, instanceId: output.InstanceId, domain, origin: `https://${domain}`, releaseDigest: digest, releaseBucket: output.ReleaseBucket, commandId: invocation.Command.CommandId };
await writeJson(join(directory, 'release.json'), record);
console.log(JSON.stringify(record));
