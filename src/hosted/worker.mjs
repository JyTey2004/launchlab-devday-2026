// Dependency-injected so restart reconciliation is tested without AWS/model spend.
export async function runJob(store, workflows, job) {
  const service = workflows(job.tenant), id = job.workflow;
  try {
    let result;
    if (job.recovered) {
      // Never replay an uncertain model or analysis call after a lost process.
      if (job.operation === 'analyze') {
        store.finish(job, { workflowId: id, message: 'Analysis was interrupted. Review saved results before explicitly requesting a new analysis with a new idempotency key.' }, 'needs_recovery'); return;
      }
      let saved;
      try { saved = await service.load(id); } catch (error) { if (error.status !== 404) throw error; }
      if (!saved) {
        if (job.operation !== 'create') throw Object.assign(new Error('Workflow needs operator inspection.'), { status: 409 });
        result = await service.create(job.payload); // No saved workflow means no prior model request.
      } else if (job.operation === 'start' && !saved.approval) {
        if (service.locked) await service.locked(id, async () => {}, { recover: true });
        const current = await service.get(id);
        if (current.revision !== job.payload.expectedRevision || current.plan?.digest !== job.payload.planDigest) throw Object.assign(new Error('Approval does not match the current plan.'), { status: 409 });
        store.reserveDeployment(job.tenant, id);
        result = await service.start(id, job.payload);
      } else if (saved.approval || (saved.status === 'planning') || (saved.status === 'blocked' && saved.experimentId)) {
        try { result = await service.resume(id, { requestKey: `recovery_${job.id}`, expectedRevision: saved.revision, retryPlanning: false }); }
        catch (error) {
          if (error.status !== 409) throw error;
          store.finish(job, { workflow: await service.get(id), message: 'Interrupted operation requires explicit review and resume; no additional model request was sent.' }, 'needs_recovery'); return;
        }
      } else if (job.operation === 'answers' && !Object.hasOwn(saved.mutations, job.payload.requestKey)) {
        if (service.locked) await service.locked(id, async () => {}, { recover: true });
        result = await service.answer(id, job.payload);
      }
      else if (job.operation === 'resume' && !Object.hasOwn(saved.mutations, job.payload.requestKey)) {
        store.finish(job, { workflow: await service.get(id), message: 'Resume was interrupted before its receipt. Review the workflow before another explicit resume.' }, 'needs_recovery'); return;
      } else result = await service.get(id);
    } else if (job.operation === 'create') result = await service.create(job.payload);
    else if (job.operation === 'answers') result = await service.answer(id, job.payload);
    else if (job.operation === 'start') {
      // Check approval before reserving a scarce hosted deployment slot.
      const current = await service.get(id);
      if (current.revision !== job.payload.expectedRevision || current.plan?.digest !== job.payload.planDigest) throw Object.assign(new Error('Approval does not match the current plan.'), { status: 409 });
      store.reserveDeployment(job.tenant, id);
      result = await service.start(id, job.payload);
    } else if (job.operation === 'resume') result = await service.resume(id, job.payload);
    else if (job.operation === 'analyze') result = await service.analyze(id, job.payload);
    else throw new Error('Unknown job operation.');
    if (job.operation !== 'analyze') {
      const saved = await service.load(id);
      if (saved.approval && saved.deploymentId) {
        store.reserveDeployment(job.tenant, id);
        // The hosted pipeline authorizes inline; only this durable worker executes.
        await service.pipeline.authorize(saved.deploymentId, { planDigest: saved.approval.planDigest });
        await service.pipeline.execute(saved.deploymentId);
        result = await service.get(id);
      }
    }
    store.finish(job, result);
  } catch (error) { store.fail(job, error); }
}
