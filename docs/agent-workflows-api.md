# External-agent launch workflow

For the current invite-only HTTPS deployment, use the
[hosted service guide](hosted-workflow-service.md) and
[24 September PROOF / REPS walkthrough](hosted-proof-reps-demo.md).
The connection and authentication instructions below describe the earlier local API.

Implemented locally on 22 September 2026. This connects the existing GPT experiment
planner, reviewed instrumentation, Amplify deployment worker and feedback collector.
It is a trusted single-operator API and stdio MCP integration. It is not a public
tenant API, an OKX AI listing, or a new payment-enabled deployment product.

## Founder and agent journey

1. Supply a GitHub repository URL and a unique request key. The project name can
   be inferred. The learning question (`hypothesis`) and audience may be omitted.
2. LaunchLab pins the commit and returns structured questions, including the app
   folder when multiple packages exist. Incomplete briefs do not call GPT.
3. Submit answers against the current workflow revision. Once inputs and the
   supported deployment recipe are complete, the existing GPT planner proposes
   tracking events, feedback questions and exact source edits.
4. Review the returned plan: pinned source, changes, deployment scope and AWS costs.
   Start using the current revision and its exact plan digest. A digest identifies
   the plan; the calling agent still needs the founder's authorization for its scope.
5. Poll the same workflow ID. The existing worker builds the isolated copy and
   publishes the preview. Reads do not call GPT or start another deployment.
6. Retrieve the verified preview URL. Preview-only login details have a separate
   authenticated retrieval operation so normal progress/report responses contain
   no passwords. Share those details privately with authorized testers.
7. Read actual metrics and voluntary feedback. Request GPT analysis separately;
   empty evidence skips the model, and unchanged evidence uses the existing cache.

The website dashboard is optional for this flow. An external agent process can
perform every operation below using HTTP or the official MCP client.

## Connection

Run the existing server with `npm start`, using the private `.env` configuration.
Managed hosting must be enabled. The API remains bound to loopback on port 4310.
Every workflow route requires `Authorization: Bearer <LAUNCHLAB_API_TOKEN>`,
including reads and preview-access retrieval. Same-origin browser access alone is
insufficient for these routes. All responses use `Cache-Control: no-store`.

For a stdio MCP host, run `node src/mcp.mjs` from this repository and provide
`LAUNCHLAB_URL=http://127.0.0.1:4310` and `LAUNCHLAB_API_TOKEN` through its private
environment configuration. The MCP client does not need OpenAI or AWS credentials.
The token grants operator access; it is not a per-customer identity. Public HTTPS
hosting, caller ownership and remote credentials delivery are subsequent work.

## Operations

All paths below are relative to `/api/agent/workflows`.

| Purpose | HTTP | MCP tool |
| --- | --- | --- |
| Create or retrieve intake | `POST` to the base path | `launchlab_plan_workflow` |
| Answer or revise before approval | `POST /:id/answers` | `launchlab_answer_workflow` |
| Approve deployment | `POST /:id/start` | `launchlab_start_workflow` |
| Read progress and next action | `GET /:id` | `launchlab_get_workflow` |
| Explicit recovery | `POST /:id/resume` | `launchlab_resume_workflow` |
| Read results | `GET /:id/report?cohort=organic&days=7` | `launchlab_workflow_report` |
| Request evidence analysis | `POST /:id/analyze` | `launchlab_analyze_workflow` |
| Retrieve private preview login | `GET /:id/access` | `launchlab_workflow_access` |

Intake example, deliberately leaving two questions unanswered:

```json
{
  "requestKey": "founder-first-launch-001",
  "repoUrl": "https://github.com/JyTey2004/launchlab-proof-reps-demo"
}
```

The response supplies a stable `wf_…` ID, `revision`, `status`, `source`,
`questions`, `blockers`, `plan`, `delivery`, `links` and `nextAction`.
MCP calls after intake include `workflowId`; HTTP requests put it in the path.
Use returned IDs and revisions rather than copying placeholders from this guide.

Answer example:

```json
{
  "requestKey": "founder-answers-001",
  "expectedRevision": 1,
  "answers": {
    "hypothesis": "Will gym-goers try this store and which payment method would they prefer?",
    "audience": "Gym-goers interested in web3 clothing"
  }
}
```

Answers may also set `name`, `rootDirectory`, `outputDirectory`, `allowRepairs`,
`refreshBuildPackages` and `nodeMajor`. They cannot replace the repository or ref,
contain credentials, bypass an unsupported runtime, or change an already authorized
deployment. A different source revision requires a new workflow.

Every changed brief creates a new revision and invalidates its previous approval.
The commit stays pinned. A revised complete brief can incur another model request;
the tool description makes that cost boundary explicit.

Start example (values must come from the current returned plan):

```json
{
  "expectedRevision": 2,
  "planDigest": "<the exact returned plan.digest>"
}
```

`plan.scope` describes the existing AWS account billing, build limit, supported
frameworks, source edits and continuing hosting. This version does not quote a
fixed customer price or impose an absolute currency spending cap. Workflow calls
are not connected to the separately tested paid readiness endpoint.

## State, retries and recovery

| Status | Calling agent's next action |
| --- | --- |
| `needs_input` | Relay the structured questions and submit answers. |
| `planning` | Poll; no automatic second model request. |
| `awaiting_approval` | Present the plan or use existing authorization for that exact scope. |
| `deploying` | Poll the existing deployment. Use explicit resume if dispatch or worker progress was interrupted. |
| `ready` | Retrieve private preview access, invite testers, and read results. No recruitment is implied. |
| `blocked` | Inspect the blocker. Unsupported source/runtime changes require another workflow. |
| `needs_recovery` | Explicitly reconcile the interrupted operation with resume. |

Persisted workflow records live under `.data/experiments/workflows/wf_…/` by
default, alongside the existing experiment store. They map workflow revisions to
the existing experiment/deployment records. Changing a brief retains old attempt
records as evidence.

- Reuse the original request key for identical intake retries. Different input
  under that key returns HTTP 409.
- Answers and recovery operations have their own request keys. Identical retries
  return current state without another model call or worker dispatch. Conflicting
  reuse and stale revisions return HTTP 409.
- Repeated starts never dispatch another worker. If a response was lost, read
  progress first, then explicitly resume the same approved deployment if needed.
- Resume can attach a completed saved plan without another model call. An
  incomplete model attempt may already have been billed: creating a new attempt
  requires `retryPlanning: true`, a new mutation request key and the current revision.
- Live locks are not removed. A known-dead process can be recovered explicitly;
  older empty or uncertain locks require operator inspection. Recovery preserves
  the old attempt and does not silently replay a billable model request.
- Status reads never resume a worker automatically. This layer is not a durable
  task queue or an automatic restart scheduler. Those are the next hosting milestone.

Recovery example:

```json
{
  "requestKey": "founder-recovery-001",
  "expectedRevision": 2,
  "retryPlanning": false
}
```

## Evidence and access boundaries

Report and analysis responses must match the workflow's deployment, experiment,
source commit and requested cohort/date range. Mismatches stop before exposing or
summarizing evidence. Before deployment, the report operation returns `not_ready`
and the workflow's next action. Analysis requires a verified deployment.

Preview-access retrieval returns only the website URL, preview username and
preview password. Report-backend tokens, AWS credentials, OpenAI keys and private
local file paths are not returned by workflow progress. Preview credentials remain
sensitive and should not be published, logged or sent to unrelated agents.

The existing collector's constraints still apply: opted-in sessions are not
verified unique humans; cohort labels are self-reported; clicks are not sales.
Internal QA and agent cohorts do not produce product recommendations. Real tester
recruitment and incentive payouts are separate work.

## Verification

`test/workflows.test.mjs` exercises the complete flow through a separate stdio MCP
process and real local HTTP server. It uses the actual experiment planner, pipeline
plan/authorization logic and file persistence, with explicit fixture boundaries for
GitHub, GPT, cloud execution and feedback. It also covers stale approvals, concurrent
starts, pinned-source questions, mutation retries, recovery, source/report mismatches
and private preview-access authorization.

The separate [live intake check](../deploy/workflow-intake-smoke.json) inspected
PROOF / REPS on GitHub through the running local service, returned the missing
learning goal and audience, then recovered the same workflow through a fresh MCP
connection. It made no model call, deployment or payment. This is not a fresh
end-to-end live AWS deployment or an OKX marketplace test.

Final local checks: **92 Node tests**, including **12 workflow tests**, **10 Python
checks** invoked by the suite, and JavaScript syntax checks passed. No new hosted
CI run or public deployment was created. The live Stardive portfolio refresh found
no matching LaunchLab issue/spec, so no unrelated delivery state was changed.
