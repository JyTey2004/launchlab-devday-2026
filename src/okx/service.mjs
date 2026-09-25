import { providerVersion, providerPaths, providerOperations, providerRequest } from './contracts.mjs';

const active = (job) => ['queued', 'running'].includes(job?.status);
const operationView = (job) => job ? {
  id: job.id, action: ({ create: 'submit', answers: 'answer', start: 'approve' })[job.operation] || job.operation,
  state: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
  recovered: job.recovered, error: job.error,
} : null;
const action = (name, input, extra = {}) => ({
  action: name, tool: providerOperations[name].tool, method: 'POST', path: providerPaths.invoke,
  input, ...extra,
});

// This is our provider contract, not an imitation of an OKX runtime envelope.
// Only the trusted provider runtime may translate it into marketplace actions.
export class ProviderService {
  constructor(gateway) { this.gateway = gateway; }

  async status(id, acceptedJob) {
    const workflow = await this.gateway.get(id), job = workflow.job;
    let state = workflow.status, nextAction, summary;
    const poll = () => action('status', { workflowId: id }, { pollAfterSeconds: 5 });
    if (active(job)) {
      state = 'working'; nextAction = poll();
      summary = `Your ${operationView(job).action} request is ${job.status}. The operation has not finished.`;
    } else if (job?.status === 'needs_recovery' || job?.status === 'failed') {
      state = 'needs_attention';
      summary = job.error?.message || job.result?.message || 'The last operation needs review before another attempt.';
      nextAction = { action: 'review_operation', message: 'Review the failed or interrupted operation and the current workflow below. Do not blindly repeat a potentially billed attempt.',
        workflowNextAction: this.next(workflow) };
    } else {
      nextAction = this.next(workflow);
      summary = ({
        needs_input: 'Please answer the project questions to continue.',
        awaiting_approval: 'The plan is ready. Review the tracking changes and ongoing hosting costs before approving deployment.',
        ready: 'Your preview is verified and ready. Results show collected evidence; they are not proof of market demand.',
        blocked: 'The workflow stopped at a blocker. Review it before continuing.',
        needs_recovery: 'The workflow was interrupted and needs explicit recovery.',
      })[state] || 'Work is in progress. Check again for the next action.';
    }
    return {
      protocol: providerVersion, workflowId: id, state, summary,
      deploymentVerified: workflow.status === 'ready' && Boolean(workflow.delivery),
      operation: operationView(job),
      ...(acceptedJob ? { receipt: { ...operationView(acceptedJob), note: 'A job receipt acknowledges an operation; it is not a marketplace delivery or payment receipt.' } } : {}),
      workflow: {
        revision: workflow.revision ?? null, state: workflow.status,
        brief: workflow.brief || null, source: workflow.source || null,
        questions: workflow.questions || [], blockers: workflow.blockers || [], plan: workflow.plan || null,
        progress: workflow.progress || null, delivery: workflow.delivery || null,
        limitations: workflow.limitations || [],
      },
      analysis: job?.operation === 'analyze' && job.status === 'completed' ? job.result?.analysis || null : null,
      nextAction,
      payment: { state: 'not_connected', chargedByThisInterface: false },
    };
  }

  next(workflow) {
    const id = workflow.id, input = { workflowId: id }, next = workflow.nextAction;
    if (next?.type === 'answer') return action('answer', { ...input, expectedRevision: workflow.revision }, {
      requiredInput: ['requestKey', 'answers'], message: 'Ask the user the returned questions. Use the question IDs as answer keys.',
    });
    if (next?.type === 'approve') return action('approve', { ...input, expectedRevision: workflow.revision, planDigest: workflow.plan.digest }, {
      requiresUserApproval: true, requiredInput: ['authorization'],
      message: 'Present the complete plan and cost scope. Only after authorization, add authorization="approved_by_user". The model cannot infer approval from a repository URL.',
    });
    if (next?.type === 'read_results') return action('results', { ...input, cohort: 'organic', days: '7' });
    if (next?.type === 'review_and_resume') return action('resume', { ...input, expectedRevision: workflow.revision, retryPlanning: false }, {
      requiresReview: true, requiredInput: ['requestKey'],
      message: next.newPlanningAttemptMayBeBillable ? 'A previous model attempt may have been billed. Review before authorizing another planning attempt.' : 'Inspect the blocker before explicitly resuming the existing workflow.',
    });
    if (next?.type === 'resolve_blocker') return { action: 'resolve_blocker', message: next.message };
    return action('status', input, { pollAfterSeconds: 5 });
  }

  async invoke(value) {
    const request = providerRequest.parse(value);
    const parsed = providerOperations[request.action].schema.parse(request.input);
    const { workflowId: id, ...input } = parsed;
    if (request.action === 'status') return { status: 200, value: await this.status(id) };
    if (request.action === 'access') return { status: 200, value: {
      protocol: providerVersion, workflowId: id, access: await this.gateway.access(id),
      sensitive: true, message: 'Preview credentials: share privately with authorized testers; exclude from public task delivery.',
    } };
    if (request.action === 'results') {
      const current = await this.status(id);
      const result = current.deploymentVerified ? await this.gateway.report(id, input) : { status: 'not_ready', report: null };
      return { status: 200, value: { ...current, results: {
        state: result.status, cohort: input.cohort, days: Number(input.days), report: result.report,
        note: 'Cohorts are labels, not verified identities. Repeated actions differ from sessions. Historical reach-only data cannot reconstruct earlier repeat clicks.',
      } } };
    }
    let job;
    if (request.action === 'submit') job = this.gateway.submit(input);
    else {
      const { authorization, requestKey, ...rest } = input;
      if (request.action === 'analyze') job = this.gateway.mutate(id, 'analyze', rest, requestKey);
      else if (request.action === 'approve') job = this.gateway.mutate(id, 'start', rest);
      else job = this.gateway.mutate(id, request.action === 'answer' ? 'answers' : 'resume', input);
    }
    return { status: active(job) ? 202 : 200, value: await this.status(job.workflowId, job) };
  }
}
