import { cp, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXAMPLE_DIR } from '../src/repos.mjs';
const destination = process.argv[2];
if (!destination) {
  console.error('Usage: npm run scaffold -- ./my-agent-experiment');
  process.exit(1);
}
const path = resolve(destination);
try {
  await access(path);
  console.error('Destination already exists. Choose a new directory.');
  process.exit(1);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(path, { recursive: true });
await cp(EXAMPLE_DIR, path, { recursive: true });
console.log(`Created a supported static experiment at ${path}`);
console.log(
  'Edit the files, push them to your own public GitHub repository, then import that URL in LaunchLab.',
);
