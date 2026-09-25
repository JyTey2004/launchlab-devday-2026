import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runInput, startInput } from './runs.mjs';
import { preflightInput } from './deployment-preflight.mjs';
import { managedInput, confirmation } from './managed/contracts.mjs';
import { experimentInput } from './agent/schemas.mjs';
import { workflowInput, workflowAnswer, workflowStart, workflowResume, workflowFilter, workflowId } from './agent/workflow-contracts.mjs';

const origin = process.env.LAUNCHLAB_URL || 'http://127.0.0.1:4310';
const server = new McpServer({ name: 'launchlab', version: '0.1.0' });
const hostedTools = new Set(['launchlab_get_job', 'launchlab_plan_workflow', 'launchlab_answer_workflow', 'launchlab_start_workflow', 'launchlab_get_workflow', 'launchlab_resume_workflow', 'launchlab_workflow_report', 'launchlab_analyze_workflow', 'launchlab_workflow_access']);
async function api(path, input, idempotencyKey) {
  const response = await fetch(`${origin}/api${path}`, {
    method: input ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(process.env.LAUNCHLAB_API_TOKEN
        ? { Authorization: `Bearer ${process.env.LAUNCHLAB_API_TOKEN}` }
        : { Origin: origin }),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function tool(name, description, schema, execute, readOnly = false) {
  if (process.env.LAUNCHLAB_HOSTED === 'true' && !hostedTools.has(name)) return;
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await execute(input)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    },
  );
}
tool(
  'launchlab_get_job',
  'Read a durable hosted LaunchLab job after a workflow operation returns HTTP 202. Returns queued, running, completed, failed or needs_recovery, saved results and the next action. Read-only; never repeats a model call or deployment. Available on the hosted service.',
  { jobId: z.string().regex(/^job_[a-f0-9]{24}$/) },
  ({ jobId }) => api(`/agent/jobs/${jobId}`), true,
);
tool(
  'launchlab_plan_workflow',
  'Start or retrieve one persistent launch workflow from a GitHub URL and unique requestKey. Optional hypothesis and audience are requested as structured questions when absent. Pins the commit, checks supported static adapters, and reuses the GPT/Amplify pipeline. Once inputs are complete, planning sends selected source to OpenAI and may bill up to two model calls; it does not deploy. Return questions or the exact plan for review. Requires the operator API token; never send secrets in inputs.',
  workflowInput.shape,
  (input) => api('/agent/workflows', input),
);
tool(
  'launchlab_answer_workflow',
  'Answer missing questions or revise an unapproved launch brief. Supply current expectedRevision and a new requestKey; reuse that requestKey only for identical network retries. Keeps the source commit pinned, invalidates old plan approvals, and may generate a new billable GPT measurement plan. Unsupported runtimes and secrets cannot be bypassed by answers.',
  { workflowId, ...workflowAnswer.shape },
  ({ workflowId, ...input }) => api(`/agent/workflows/${workflowId}/answers`, input),
);
tool(
  'launchlab_start_workflow',
  'Approve and start the reviewed launch workflow with its current revision and exact plan digest. Requires user authorization for the returned AWS cost and repair scope. Reuses the existing isolated deployment worker; repeated starts do not dispatch another worker. Returns progress immediately. No GitHub writes or tester rewards.',
  { workflowId, ...workflowStart.shape },
  ({ workflowId, ...input }) => api(`/agent/workflows/${workflowId}/start`, input),
);
tool(
  'launchlab_get_workflow',
  'Read one workflow: current questions, reviewable tracking changes, cost scope, approved source, deployment progress, verified delivery and the next agent action. Read-only; polling never calls GPT, starts work or charges for status. Preview passwords are excluded.',
  { workflowId },
  ({ workflowId }) => api(`/agent/workflows/${workflowId}`), true,
);
tool(
  'launchlab_resume_workflow',
  'Explicitly recover an interrupted workflow. Reattaches a saved completed plan or resumes the already approved deployment ID. An incomplete model attempt is never retried unless retryPlanning=true explicitly authorizes a potentially additional billed attempt. Inspect blockers first. Reuse the mutation requestKey for identical retries; active operations and uncertain locks fail closed.',
  { workflowId, ...workflowResume.shape },
  ({ workflowId, ...input }) => api(`/agent/workflows/${workflowId}/resume`, input),
);
tool(
  'launchlab_workflow_report',
  'Read measured activity and submitted feedback for a verified workflow deployment. Select organic, incentivized, agent or test cohort; these labels are not verified identities. Before deployment completes, returns not_ready with its next action. No model call, build or charge.',
  { workflowId, ...workflowFilter.shape },
  ({ workflowId, cohort, days }) => api(`/agent/workflows/${workflowId}/report?cohort=${cohort}&days=${days}`), true,
);
tool(
  'launchlab_analyze_workflow',
  'Request the existing GPT evidence summary for a deployed workflow. May bill one model call; identical evidence is cached and empty evidence skips GPT. Separates observed actions, user statements and hypotheses; test/agent cohorts cannot generate product recommendations.',
  { workflowId, ...workflowFilter.shape, requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional() },
  ({ workflowId, requestKey, ...input }) => api(`/agent/workflows/${workflowId}/analyze`, input, requestKey),
);
tool(
  'launchlab_workflow_access',
  'Explicitly retrieve sensitive preview-only login details for a verified workflow using the trusted operator token. Share privately with authorized testers; never publish or log these credentials. Does not return cloud, GitHub, OpenAI or report-backend secrets.',
  { workflowId },
  ({ workflowId }) => api(`/agent/workflows/${workflowId}/access`), true,
);
tool(
  'launchlab_plan_experiment',
  'Use GPT to inspect a pinned GitHub frontend and prepare registered tracking hooks and contextual feedback questions. Sends selected frontend source to OpenAI, bills at most two bounded model calls, and creates no cloud deployment. Return the plan, patch previews and deployment digest for review. Never send credentials in the brief.',
  experimentInput.shape,
  (input) => api('/agent/experiments', input),
);
tool(
  'launchlab_start_experiment',
  'Deploy an already authorized validation experiment in the configured AWS account. Requires its exact plan digest. Applies tracking edits in an isolated build, attaches the feedback service and returns immediately. Does not write to GitHub.',
  { experimentId: z.string(), ...confirmation.shape },
  ({ experimentId, ...input }) => api(`/agent/experiments/${encodeURIComponent(experimentId)}/start`, input),
);
tool(
  'launchlab_get_experiment',
  'Read the GPT experiment plan, patch previews and managed deployment status. No model calls or deployment mutations.',
  { experimentId: z.string() },
  ({ experimentId }) => api(`/agent/experiments/${encodeURIComponent(experimentId)}`), true,
);
tool(
  'launchlab_experiment_report',
  'Read actual product events, cumulative reach and user responses for a deployed experiment. Keeps internal tests, agents and incentive labels separate. No model call.',
  { experimentId: z.string(), cohort: z.enum(['organic','incentivized','agent','test']).default('organic'), days: z.enum(['7','30']).default('7') },
  ({ experimentId, cohort, days }) => api(`/agent/experiments/${encodeURIComponent(experimentId)}/report?cohort=${cohort}&days=${days}`), true,
);
tool(
  'launchlab_analyze_experiment',
  'Ask GPT to summarize one experiment audience using actual metrics and de-identified feedback. Uses one bounded billable model call, caches identical evidence and skips empty evidence. Returns separate observed, reported and suggested sections with references; suggestions are hypotheses, not proven causes.',
  { experimentId: z.string(), cohort: z.enum(['organic','incentivized','agent','test']).default('organic'), days: z.enum(['7','30']).default('7') },
  ({ experimentId, ...input }) => api(`/agent/experiments/${encodeURIComponent(experimentId)}/analyze`, input),
);
tool(
  'launchlab_overview',
  'List projects, releases, campaigns and feedback. Local prototype; rewards are demo credits.',
  {},
  () => api('/overview'),
  true,
);
tool(
  'launchlab_inspect_deployment',
  'Inspect a GitHub repository without executing code. Pin its commit, return framework evidence and an advisory deployment recipe with build/install settings, hosting candidate and focused configuration questions. Next.js/Vite/static recipes are recognized; other runtimes require adapter review. No manifest is required. Inspection alone does not authorize or execute hosting. Use plan_deployment for the narrower managed static adapter. Never pass credentials or environment values to this tool.',
  preflightInput.shape,
  (input) => api('/deployments/inspect', input),
  true,
);
tool(
  'launchlab_plan_deployment',
  'Plan a real AWS deployment from a GitHub repo. Pins a commit, isolates the new project, states billable scope and returns a planDigest. No infrastructure is created by planning. Optional bounded build repairs update only a disposable copy and return a package patch; never send secrets here. Present the plan or check existing authorization before starting.',
  managedInput.shape,
  (input) => api('/managed-deployments', input),
);
tool(
  'launchlab_start_deployment',
  'Start the authorized AWS deployment and experiment backend. Incurs AWS usage in the configured operator account. Requires the exact planDigest and existing user authorization for the returned cost/repair scope. Returns immediately; poll get_deployment. Does not modify the source GitHub repository.',
  { deploymentId: z.string(), ...confirmation.shape },
  ({ deploymentId, ...input }) => api(`/managed-deployments/${encodeURIComponent(deploymentId)}/start`, input),
);
tool(
  'launchlab_get_deployment',
  'Read managed deployment progress, questions, blockers, pinned revision, repair evidence and verified website/report links. No new cloud resources or builds are created.',
  { deploymentId: z.string() },
  ({ deploymentId }) => api(`/managed-deployments/${encodeURIComponent(deploymentId)}`),
  true,
);
tool(
  'launchlab_deployment_report',
  'Read this deployed project’s private experiment results without exposing its report key. Separate organic, incentivized, agent and internal-test cohorts. Interaction is not proof of sales or human identity.',
  { deploymentId: z.string(), cohort: z.enum(['organic', 'incentivized', 'agent', 'test']).default('organic'), days: z.enum(['7', '30']).default('7') },
  ({ deploymentId, cohort, days }) => api(`/managed-deployments/${encodeURIComponent(deploymentId)}/report?cohort=${cohort}&days=${days}`),
  true,
);
tool(
  'launchlab_plan_run',
  'Plan one experiment from a brief. Pins the supported source and demo-credit allocation without deploying or opening a campaign. Reuse requestKey for retries; use a new key for changed scope. Present the returned plan for confirmation or check existing authorization before starting.',
  runInput.shape,
  (input) => api('/runs', input),
);
tool(
  'launchlab_start_run',
  'Execute the confirmed run plan: prepare the pinned local preview, check it and open one demo-credit campaign. Pass its exact planDigest. Repeated calls do not create another campaign. Inspect status and blocker; collecting still requires operator-invited testers. No public deployment or real spending.',
  { runId: z.string(), ...startInput.shape },
  ({ runId, ...input }) => api(`/runs/${encodeURIComponent(runId)}/start`, input),
);
tool(
  'launchlab_get_run',
  'Read run status, next action, source, preview, feedback and accounting. Polling does not start work or incur a charge. Accepted submissions do not establish unique humans or demand.',
  { runId: z.string() },
  ({ runId }) => api(`/runs/${encodeURIComponent(runId)}`),
  true,
);
tool(
  'launchlab_close_run',
  'Stop new reservations for a run. Preserve all existing sessions, submitted feedback and review/reward obligations. Closing does not pay or refund funds.',
  { runId: z.string() },
  ({ runId }) => api(`/runs/${encodeURIComponent(runId)}/close`, {}),
);
tool(
  'launchlab_import',
  'Import a public GitHub static project with launchlab.json, or omit repoUrl for the bundled Hello X Layer example. Pins a commit/source digest; executes no repository code.',
  { repoUrl: z.string().url().optional(), ref: z.string().optional() },
  (input) => api('/projects', input),
);
tool(
  'launchlab_deploy',
  'Prepare and HTTP-check a local static preview. Does not deploy smart contracts or public infrastructure.',
  { projectId: z.string() },
  (input) => api('/releases', input),
);
tool(
  'launchlab_open_campaign',
  'Open a local test campaign for a ready release with a capped demo-credit pool. Human recruitment and real payouts are not connected.',
  {
    releaseId: z.string(),
    title: z.string(),
    audience: z.string(),
    task: z.string(),
    budget: z.number().int(),
    reward: z.number().int(),
  },
  (input) => api('/campaigns', input),
);
tool(
  'launchlab_report',
  'Get feedback with release provenance and reward accounting. Paid participation is not validation of organic demand.',
  { campaignId: z.string() },
  (input) => api(`/campaigns/${encodeURIComponent(input.campaignId)}/report`),
  true,
);
tool(
  'launchlab_review',
  'Record an explicit evidence review. Accept honest negative feedback or documented blockers. Awards demo credits only. Caller must inspect the feedback first.',
  { feedbackId: z.string(), decision: z.enum(['accept', 'reject']), reason: z.string().min(10) },
  (input) =>
    api(`/feedback/${encodeURIComponent(input.feedbackId)}/review`, {
      decision: input.decision,
      reason: input.reason,
    }),
);
tool(
  'launchlab_network',
  'Read the configured X Layer testnet RPC chain ID. Reports unavailable honestly; sends no transaction.',
  {},
  () => api('/network'),
  true,
);
await server.connect(new StdioServerTransport());
