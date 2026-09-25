import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Aws } from '../src/managed/io.mjs';
import { hash } from '../src/managed/contracts.mjs';

// Generate the bearer locally. Only its digest crosses SSM or appears in command
// history. The caller receives the private output file, not console output.
process.umask(0o077);
const [name, destination] = process.argv.slice(2);
if (!name || !destination || name.length > 80) throw new Error('Usage: hosted-invite.mjs <caller-name> <new-private-file>');
const directory = resolve('.data/hosted-operator');
const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
const tenant = `tenant_${randomBytes(10).toString('hex')}`, id = `key_${randomBytes(10).toString('hex')}`, token = `ll_${randomBytes(32).toString('base64url')}`;
await writeFile(resolve(destination), JSON.stringify({ origin: release.origin, tenant, id, token }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const data = Buffer.from(JSON.stringify({ tenant, id, digest: hash(token), name })).toString('base64');
const script = `import json,base64,sqlite3\nx=json.loads(base64.b64decode('${data}'))\nwith sqlite3.connect('/var/lib/launchlab/service.sqlite') as db:\n db.execute('INSERT INTO tenants VALUES (?,?)',(x['tenant'],x['name']))\n db.execute('INSERT INTO keys(id,tenant,digest) VALUES (?,?,?)',(x['id'],x['tenant'],x['digest']))\nprint('LaunchLab caller provisioned. No bearer token sent to SSM.')\n`;
const aws = new Aws({ profile: 'stardive', region: 'ap-southeast-1', account: '113978311640', directory }); await aws.verify();
const result = await aws.call('ssm', 'send-command', { InstanceIds: [release.instanceId], DocumentName: 'AWS-RunShellScript', Comment: 'Provision an invite-only LaunchLab caller using a hashed key', Parameters: { commands: [`python3 - <<'PY'\n${script}\nPY`] } });
console.log(JSON.stringify({ tenant, keyId: id, credentialFile: resolve(destination), commandId: result.Command.CommandId }));
