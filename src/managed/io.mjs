import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const exec = promisify(execFile);
export async function command(bin, args, options = {}) {
  try { return await exec(bin, args, { timeout: 120000, maxBuffer: 35_000_000, ...options }); }
  catch (error) {
    // Never include CLI arguments, environment, signed URLs or raw request files.
    const failure = new Error(`${bin} ${args[0] || ''} failed.`);
    failure.detail = String(error.stderr || '').slice(-2000);
    throw failure;
  }
}
export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function writeJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}
export class Aws {
  constructor({ profile, region, account, directory }) { Object.assign(this, { profile, region, account, directory }); }
  async call(service, action, input = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `aws-${randomBytes(10).toString('hex')}.json`);
    await writeFile(file, JSON.stringify(input), { mode: 0o600, flag: 'wx' });
    try {
      const { stdout } = await command('aws', [service, action, '--cli-input-json', `file://${file}`, ...awsOptions(this), '--output', 'json']);
      return stdout.trim() ? JSON.parse(stdout) : {};
    } finally { await unlink(file); }
  }
  async verify() {
    if ((await this.call('sts', 'get-caller-identity')).Account !== this.account) throw new Error('AWS account does not match the configured LaunchLab account.');
  }
}
export const awsOptions = ({ profile, region }) => [...(profile ? ['--profile', profile] : []), '--region', region];
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
