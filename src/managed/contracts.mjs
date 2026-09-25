import { z } from 'zod';
import { createHash } from 'node:crypto';

export const relativePath = z.string().max(160).refine((v) => v === '.' || v.split('/').every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && !['.', '..'].includes(part)), 'Use a repository-relative path.');
export const managedInput = z.object({
  requestKey: z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  repoUrl: z.string().url().max(300), ref: z.string().min(1).max(200).default('HEAD'),
  name: z.string().min(3).max(40).regex(/^[a-z][a-z0-9-]+$/),
  rootDirectory: relativePath.optional(), outputDirectory: relativePath.optional(),
  hypothesis: z.string().trim().min(10).max(500),
  goalEvent: z.string().min(3).max(40).regex(/^[a-z][a-z0-9_]+$/).default('try_demo'),
  allowRepairs: z.boolean().default(false), refreshBuildPackages: z.boolean().default(false),
  nodeMajor: z.enum(['22', '24']).default('22'),
  experimentId: z.string().regex(/^exp_[a-f0-9]{20}$/).optional(),
  experimentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((v) => !v.refreshBuildPackages || v.allowRepairs, 'Package updates require allowRepairs.')
  .refine((v) => Boolean(v.experimentId) === Boolean(v.experimentDigest), 'An experiment ID and digest must be supplied together.');
export const confirmation = z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const hash = (v) => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
export const deploymentId = (requestKey) => `dep_${hash(requestKey).slice(0, 20)}`;
export const validId = (value) => /^dep_[a-f0-9]{20}$/.test(value);

export function buildRecipe(input, inspection) {
  const detected = inspection.detected;
  const questions = [];
  if (!inspection.source?.commitSha || !detected) return { questions: inspection.questions?.length ? inspection.questions : [{ id: 'source', prompt: 'Repository inspection is incomplete.' }] };
  if (!['vite', 'static'].includes(detected.framework)) questions.push({ id: 'framework', prompt: `The Amplify static adapter does not yet support ${detected.framework}. A server or framework adapter is required.` });
  if (detected.runtimeReviewRequired || detected.environmentKeys.length) questions.push({ id: 'runtime', prompt: 'This app declares runtime services or environment variables. Configure a supported runtime/secret binding before deployment.' });
  if (detected.framework === 'vite' && detected.packageManager && detected.packageManager !== 'npm') questions.push({ id: 'packageManager', prompt: 'This build worker currently supports npm. Keep this repository’s package manager; add its adapter before deployment.' });
  if (detected.lockfiles.some((f) => f.manager !== 'npm')) questions.push({ id: 'lockfileConflict', prompt: 'A non-npm lockfile is present. Confirm the authoritative package manager before deployment.' });
  if (inspection.questions?.some((q) => q.id === 'packageManager' && /conflict/.test(q.prompt))) questions.push({ id: 'managerConflict', prompt: 'Package manager and lockfile declarations conflict; resolve them in the repository.' });
  if (inspection.questions?.some((q) => ['packageManagerConflict', 'workspace'].includes(q.id))) questions.push(...inspection.questions.filter((q) => ['packageManagerConflict', 'workspace'].includes(q.id)));
  if (detected.framework === 'vite' && !detected.hasBuildScript && !input.allowRepairs) questions.push({ id: 'buildScript', prompt: 'The Vite build script is missing. Allow bounded repairs or add a build script in the repository.' });
  if (detected.framework === 'vite' && !detected.lockfiles.some((f) => f.manager === 'npm') && !input.allowRepairs) questions.push({ id: 'lockfile', prompt: 'An npm lockfile is required. Allow bounded repairs to generate one in the isolated build.' });
  if (detected.lockfiles.some((f) => !f.path.startsWith(detected.rootDirectory === '.' ? '' : detected.rootDirectory + '/'))) questions.push({ id: 'workspaceRoot', prompt: 'The application depends on an ancestor workspace lockfile. Workspace builds require another adapter.' });
  return { questions, framework: detected.framework, rootDirectory: detected.rootDirectory,
    outputDirectory: input.outputDirectory || (detected.framework === 'static' ? '.' : 'dist'),
    nodeMajor: input.nodeMajor, allowRepairs: input.allowRepairs, refreshBuildPackages: input.refreshBuildPackages,
    worker: 'aws-codebuild', install: 'npm ci --ignore-scripts', build: 'npm run build --ignore-scripts',
    limits: { buildMinutes: 10, attempts: 1, sourceBytes: 30_000_000, outputBytes: 30_000_000, files: 2500 },
    repairPolicy: { engine: 'bounded-rules-v1', allowedPackages: ['vite', '@vitejs/plugin-react', '@vitejs/plugin-vue', 'typescript'], versionPolicy: 'stable same-major only', patchOnly: true, writesToGitHub: false },
  };
}
