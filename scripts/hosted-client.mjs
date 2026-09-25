import { resolve, join } from 'node:path';
import { writeFile, chmod } from 'node:fs/promises';
import { HostedStore } from '../src/hosted/store.mjs';
process.umask(0o077);
const [action, value, output] = process.argv.slice(2);
const directory = resolve(process.env.LAUNCHLAB_HOSTED_DATA || '.data/hosted');
const store = new HostedStore(join(directory, 'service.sqlite'));
try {
  if (action === 'revoke') { store.revokeKey(value); console.log('Service key revoked.'); }
  else if ((action === 'create' || action === 'rotate') && output) {
    const tenant = action === 'create' ? store.createTenant(value) : value;
    const key = store.issueKey(tenant);
    await writeFile(resolve(output), JSON.stringify(key) + '\n', { flag: 'wx', mode: 0o600 });
    await chmod(resolve(output), 0o600);
    console.log(JSON.stringify({ tenant, keyId: key.id, credentialFile: resolve(output) }));
  } else throw new Error('Usage: hosted-client.mjs create <name> <new-private-file> | rotate <tenant-id> <new-private-file> | revoke <key-id>');
} finally { store.close(); }
