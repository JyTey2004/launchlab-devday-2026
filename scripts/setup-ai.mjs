import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../.env', import.meta.url));
let value = '';
try { value = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const defaults = {
  OPENAI_API_KEY: '',
  LAUNCHLAB_OPENAI_MODEL: 'gpt-5.4-2026-03-05',
  LAUNCHLAB_MANAGED_ENABLED: 'true',
  LAUNCHLAB_MANAGED_CONFIG: 'deploy/managed-hosting.json',
  LAUNCHLAB_API_TOKEN: randomBytes(32).toString('hex'),
  PORT: '4310', PREVIEW_PORT: '4311',
};
for (const [key, setting] of Object.entries(defaults)) {
  if (!new RegExp(`^${key}=`, 'm').test(value)) value += `${value.endsWith('\n') || !value ? '' : '\n'}${key}=${setting}\n`;
}
await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600);
console.log(`Private settings ready: ${path}\nSet OPENAI_API_KEY in that file, then restart with npm start.\nOpen http://127.0.0.1:4310/agent. No key or model request was printed or sent.`);
