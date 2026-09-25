// Shared with the isolated worker. Generated edits can only add registered tracking hooks.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
export function validatePatchPath(path) {
  if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:html|js|mjs|jsx|ts|tsx)$/.test(path) || /(^|\/)\./.test(path)) fail('Unsupported instrumentation path.');
}
export function patchSource(source, patches) {
  let result = source;
  for (const p of patches) {
    if (!/^[a-z][a-z0-9_]{2,39}$/.test(p.eventId)) fail('Invalid instrumentation event.');
    const at = result.indexOf(p.anchor);
    if (!p.anchor || at < 0 || result.indexOf(p.anchor, at + p.anchor.length) >= 0) fail(`Tracking anchor is missing or ambiguous in ${p.path}.`);
    let replacement;
    if (p.placement === 'attribute') {
      if (!/^<(?:button|a|input|select)\b[^<>]*>$/.test(p.anchor) || /data-launchlab-event|\/\s*>$/.test(p.anchor)) fail(`Attribute hook ${p.eventId} in ${p.path} requires only one unmarked opening button/a/input/select tag, without text, nested or closing tags, or surrounding whitespace.`);
      replacement = p.anchor.slice(0, -1) + ` data-launchlab-event="${p.eventId}">`;
    } else {
      if (!['before', 'after'].includes(p.placement) || !/\.(?:js|mjs|jsx|ts|tsx)$/.test(p.path)) fail('Unsupported source integration.');
      const beforeLine = result.slice(0, at).split('\n').at(-1), afterLine = result.slice(at + p.anchor.length).split('\n')[0];
      if (beforeLine.trim() || afterLine.trim()) fail('JavaScript hooks require a complete source line or block as the anchor.');
      const hook = `;globalThis.LaunchLab?.track(${JSON.stringify(p.eventId)});`;
      replacement = p.placement === 'before' ? `${hook}\n${p.anchor}` : `${p.anchor}\n${hook}`;
    }
    result = result.slice(0, at) + replacement + result.slice(at + p.anchor.length);
  }
  return result;
}
export async function applyInstrumentation(root, plan) {
  const changes = [];
  for (const [path, originalHash] of Object.entries(plan.files)) {
    validatePatchPath(path);
    const file = resolve(root, path);
    if (!file.startsWith(resolve(root) + '/')) fail('Instrumentation path escapes the source.');
    const before = await readFile(file, 'utf8');
    if (digest(before) !== originalHash) fail(`Source changed since the instrumentation plan: ${path}.`);
    const after = patchSource(before, plan.design.patches.filter((p) => p.path === path));
    changes.push({ path, before, after });
  }
  // Validate every patch before writing any file.
  for (const change of changes) await writeFile(resolve(root, change.path), change.after);
  return changes.map(({ path, before, after }) => ({ path, beforeHash: digest(before), afterHash: digest(after) }));
}
export function verifyInstrumentationBuild(plan, report) {
  if (report?.experimentId !== plan.id || report.sourceCommit !== plan.source.commitSha) fail('Build instrumentation does not match the reviewed experiment.');
  const expected = plan.previews.map(({ path, beforeHash, afterHash }) => ({ path, beforeHash, afterHash })).sort((a,b) => a.path.localeCompare(b.path));
  const actual = [...(report.changes || [])].sort((a,b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('Build source changes differ from the reviewed instrumentation.');
}
