import { z } from 'zod';
import { managedInput } from '../managed/contracts.mjs';

const id = z.string().regex(/^[a-z][a-z0-9_]{2,39}$/);
const text = (max) => z.string().trim().min(1).max(max);
const { experimentId, experimentDigest, ...deploymentFields } = managedInput.shape;
export const experimentInput = z.object({
  ...deploymentFields,
  audience: text(300),
}).strict().refine((v) => !v.refreshBuildPackages || v.allowRepairs, 'Package updates require allowRepairs.');
export const designSchema = z.object({
  summary: text(800),
  events: z.array(z.object({ id, label: text(80), reason: text(250) }).strict()).min(1).max(8),
  funnel: z.array(id).min(1).max(8),
  questions: z.array(z.object({ id, label: text(200), kind: z.enum(['choice', 'text']), options: z.array(z.object({ id, label: text(100) }).strict()).max(6) }).strict()).min(1).max(3),
  patches: z.array(z.object({ path: text(160), anchor: text(1200), placement: z.enum(['before', 'after', 'attribute']), eventId: id }).strict()).min(1).max(16),
  limitations: z.array(text(300)).max(8),
}).strict();
export const insightSchema = z.object({
  observations: z.array(z.object({ text: text(600), evidenceIds: z.array(text(80)).min(1).max(8) }).strict()).max(6),
  reported: z.array(z.object({ text: text(600), evidenceIds: z.array(text(80)).min(1).max(8) }).strict()).max(6),
  suggestions: z.array(z.object({ text: text(600), evidenceIds: z.array(text(80)).min(1).max(8) }).strict()).max(4),
  limitations: z.array(text(300)).min(1).max(6),
}).strict();
export function insightSchemaForEvidence(evidence) {
  const all = evidence.items.map((item) => item.id);
  if (!all.length) throw new Error('Analysis requires evidence identifiers.');
  const section = (kind, limit) => {
    const ids = kind ? evidence.items.filter((item) => item.kind === kind).map((item) => item.id) : all;
    return z.array(z.object({ text: text(600), evidenceIds: z.array(z.enum(ids.length ? ids : all)).min(1).max(8) }).strict()).max(ids.length ? limit : 0);
  };
  return z.object({ observations: section('observed',6), reported: section('reported',6), suggestions: section(null,4), limitations: z.array(text(300)).min(1).max(6) }).strict();
}
export const jsonSchema = (schema) => z.toJSONSchema(schema, { target: 'draft-7' });

export function validateDesign(input) {
  const value = designSchema.parse(input);
  const unique = (values, name) => { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}.`); };
  unique(value.events.map((e) => e.id), 'event identifiers'); unique(value.questions.map((q) => q.id), 'question identifiers'); unique(value.funnel, 'funnel steps');
  const allowed = new Set(value.events.map((e) => e.id));
  if (allowed.has('page_view') || allowed.has('primary_action')) throw new Error('Reserved event identifier.');
  if (value.funnel.some((e) => !allowed.has(e)) || value.patches.some((p) => !allowed.has(p.eventId))) throw new Error('Undeclared event.');
  if (value.events.some((e) => !value.patches.some((p) => p.eventId === e.id))) throw new Error('Every event requires a source integration.');
  for (const q of value.questions) {
    unique(q.options.map((o) => o.id), 'answer identifiers');
    if (q.kind === 'choice' && q.options.length < 2 || q.kind === 'text' && q.options.length !== 0) throw new Error('Invalid question options.');
  }
  return value;
}
