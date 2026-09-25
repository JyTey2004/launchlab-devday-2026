import { z } from 'zod';
import { managedInput } from '../managed/contracts.mjs';

const fields = managedInput.shape;
const audience = z.string().trim().min(1).max(300);
export const workflowInput = z.object({
  requestKey: fields.requestKey,
  repoUrl: fields.repoUrl,
  ref: fields.ref,
  name: fields.name.optional(),
  hypothesis: fields.hypothesis.optional(),
  audience: audience.optional(),
  rootDirectory: fields.rootDirectory,
  outputDirectory: fields.outputDirectory,
  allowRepairs: fields.allowRepairs,
  refreshBuildPackages: fields.refreshBuildPackages,
  nodeMajor: fields.nodeMajor,
}).strict().refine((v) => !v.refreshBuildPackages || v.allowRepairs, 'Package updates require allowRepairs.');

const answers = z.object({
  name: fields.name.optional(),
  hypothesis: fields.hypothesis.optional(),
  audience: audience.optional(),
  rootDirectory: fields.rootDirectory,
  outputDirectory: fields.outputDirectory,
  allowRepairs: z.boolean().optional(),
  refreshBuildPackages: z.boolean().optional(),
  nodeMajor: z.enum(['22', '24']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Supply at least one answer.');

export const workflowAnswer = z.object({
  requestKey: fields.requestKey,
  expectedRevision: z.number().int().positive(),
  answers,
}).strict();
export const workflowStart = z.object({
  expectedRevision: z.number().int().positive(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const workflowResume = z.object({
  requestKey: fields.requestKey,
  expectedRevision: z.number().int().positive(),
  // A previous model request may already have been billed. Never retry it implicitly.
  retryPlanning: z.boolean().default(false),
}).strict();
export const workflowFilter = z.object({
  cohort: z.enum(['organic', 'incentivized', 'agent', 'test']).default('organic'),
  days: z.enum(['7', '30']).default('7'),
}).strict();
export const workflowId = z.string().regex(/^wf_[a-f0-9]{20}$/);
