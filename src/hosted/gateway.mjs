import { hash } from '../managed/contracts.mjs';
import { workflowInput, workflowAnswer, workflowStart, workflowResume, workflowFilter, workflowId } from '../agent/workflow-contracts.mjs';
import { requireThat } from '../store.mjs';
import { parseRepository } from '../repos.mjs';

// Shared by the original HTTP API and the provider bridge. All transports use
// the same ownership checks, durable receipts, quotas and worker queue.
export function workflowGateway({ store, workflows }, tenant) {
  const owns = (id) => { workflowId.parse(id); store.owns(tenant, id); };
  return {
    submit(value) {
      const input = workflowInput.parse(value);
      parseRepository(input.repoUrl);
      const key = `hosted_${hash({ tenant, key: input.requestKey })}`;
      const workflow = `wf_${hash(key).slice(0, 20)}`;
      return store.enqueue({ tenant, workflow, operation: 'create', requestKey: input.requestKey, payload: { ...input, requestKey: key } });
    },
    async get(id) {
      owns(id);
      const job = store.latest(tenant, id);
      try { return { ...await workflows(tenant).get(id), job }; }
      catch (error) {
        if (error.status !== 404) throw error;
        return { id, status: 'queued', job };
      }
    },
    job(id) { return store.job(tenant, id); },
    async report(id, value) { owns(id); return workflows(tenant).report(id, workflowFilter.parse(value)); },
    async access(id) { owns(id); return workflows(tenant).access(id); },
    mutate(id, operation, value, idempotencyKey) {
      owns(id);
      const schemas = { answers: workflowAnswer, start: workflowStart, resume: workflowResume, analyze: workflowFilter };
      requireThat(Object.hasOwn(schemas, operation), 'Route not found.', 404);
      const payload = schemas[operation].parse(value);
      const requestKey = payload.requestKey || (operation === 'start' ? `start_${payload.expectedRevision}_${payload.planDigest}` : idempotencyKey);
      return store.enqueue({ tenant, workflow: id, operation, requestKey, payload });
    },
  };
}
