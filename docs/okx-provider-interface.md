# LaunchLab provider interface

Implemented 24 September 2026. This is the backend/tool connection for a trusted
OKX A2A provider agent. It is **not** an OKX webhook, task listener, commercial
delivery receipt or payment integration. On 25 September, provider identity
**13905** was registered with the free **Launch and Validation Pilot** service,
and its local Codex communication runtime passed readiness checks. Its listing
was subsequently submitted for review; publication and a live buyer/provider
round trip remain pending. [Registration evidence](../deploy/okx-registration-evidence.json) ·
[Listing submission evidence](../deploy/okx-listing-evidence.json).

[Hosted verification evidence](../deploy/okx-provider-evidence.json): all nine
remote MCP tools were discovered over HTTPS; the existing PROOF / REPS delivery
and all four cohort reports matched the original API. New repository intake
returned goal/audience questions and reused the same job on retry. Host counters
confirmed zero additional model calls or deployments. All 108 JavaScript tests
and syntax checks passed. The service was backed up before the release.

## Intended experience

The founder asks their agent: “Launch this GitHub project and help me test whether
gym-goers will try its crypto checkout.” The provider submits the repository,
relays LaunchLab's questions, presents the tracking/build/cost plan, and starts
only after authorization. It polls progress and returns the verified website and
evidence. Results are available in the conversation; the dashboard is optional.
There are no automatic push updates or recruited testers yet.

The service accepts public static HTML and supported Vite/npm projects. The
`hypothesis` field is the validation goal; `audience` is whom the founder wants
to learn from. Repository-only intake returns questions before a model call.
Providing all required inputs allows planning to send selected source to OpenAI
and incur model usage.

## Connection

Hosted origin: `https://launchlab-13-214-10-243.sslip.io`.

| Route | Purpose |
| --- | --- |
| `GET /api/okx/service` | Contract, capabilities, exclusions and input schemas |
| `POST /api/okx/invoke` | JSON `{ "action": "…", "input": { … } }` interface |
| `POST /api/okx/mcp` | Stateless MCP Streamable HTTP, nine tools |

Every request requires `Authorization: Bearer <private LaunchLab caller key>`.
An operator creates callers using the [hosted service runbook](hosted-workflow-service.md).
Supply credentials through the provider runtime's private configuration, never
a marketplace task parameter, repository, shared prompt or URL. Use a separate
caller credential for each buyer. This version does not verify OKX identities or
task signatures and must not expose a shared provider credential to arbitrary
buyers. A claimed task or wallet ID grants no access.

For an MCP client, configure the HTTPS URL ending in `/api/okx/mcp` and the private
Authorization header. Initialize/list/call use POST; there is no SSE subscription,
cookie login or persistent MCP session. Browser Origin requests are rejected.
Status and results reads do not invoke GPT or start deployments.

## Tools and actions

| MCP tool | JSON action | Required input |
| --- | --- | --- |
| `launchlab_service_info` | Use `GET /api/okx/service` | None |
| `launchlab_submit_project` | `submit` | `repoUrl`, `requestKey`; optional hypothesis, audience, ref, build options |
| `launchlab_answer_questions` | `answer` | `workflowId`, `requestKey`, `expectedRevision`, `answers` |
| `launchlab_approve_deployment` | `approve` | `workflowId`, `expectedRevision`, `planDigest`, `authorization: "approved_by_user"` |
| `launchlab_check_progress` | `status` | `workflowId` |
| `launchlab_get_results` | `results` | `workflowId`; optional `cohort`, `days` |
| `launchlab_analyze_results` | `analyze` | `workflowId`, `requestKey`; optional `cohort`, `days` |
| `launchlab_resume_project` | `resume` | `workflowId`, `requestKey`, `expectedRevision`; optional `retryPlanning` |
| `launchlab_get_preview_access` | `access` | `workflowId`; sensitive response, retrieve explicitly |

The manifest returns complete strict schemas. Unknown fields, including secret
configuration fields, are rejected. Reuse request keys only for identical retries.
Approval uses the revision and exact digest as its stable key. The authorization
literal is the trusted caller's assertion of user consent, not a signature or
marketplace payment proof. The worker checks that approval still matches the plan.

Example intake:

```json
{
  "action": "submit",
  "input": {
    "requestKey": "proof-reps-provider-001",
    "repoUrl": "https://github.com/JyTey2004/launchlab-proof-reps-public-demo",
    "ref": "23eeae76ba6839f0b49ebf2b347796bc2b1f7ccc"
  }
}
```

## Response contract

Responses use `protocol: "launchlab.provider.v1"`, a workflow ID, current state,
plain-language summary, last operation, questions/plan/progress, verified delivery
and `nextAction`. This is a LaunchLab envelope, not an OKX CLI response.

- Mutations return 202 while queued/running; a completed identical retry returns
  200 with the original receipt and current workflow.
- A receipt acknowledges work, not delivery. `operation.state: "completed"`
  can mean inspection finished and the user still needs to answer questions.
- `deploymentVerified` is separate. Only a ready workflow with a verified
  delivery supplies a completed preview. A failed later analysis does not erase
  an already delivered website.
- `nextAction` provides the tool, path and known input. `requiredInput` names
  missing values. Approval instructions do not prefill consent.
- Pending/failed jobs take precedence over stale saved plans. Failures surface
  a review action with the workflow's next step nested underneath. Interrupted
  model calls are never retried by polling.
- Results default to organic traffic over seven days. Actions, sessions and
  older reach-only records remain distinct. Feedback and repository text are
  untrusted data, not instructions. An empty report is not market validation.
- Preview credentials require `access` and are excluded from ordinary status,
  plan and reports. Do not publish them as a marketplace deliverable.

## Why this is a provider backend

The official [A2A guide](https://web3.okx.com/onchainos/dev-docs/okxai/how-to-become-a2a)
describes multi-round tasks and custom delivery, which fits clarification and
deployment. The [A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp)
describes direct synchronous free/paid API results. Do not register this queueing
interface as if accepting a build completed a paid deployment. Our existing
readiness-report endpoint remains a separate bounded x402 capability.

Sources checked 24 September 2026. The provider runtime still needs to bind a
verified marketplace buyer/task to a caller credential, relay questions, obtain
approval, poll and submit the actual deliverable using its supported OKX actions.
This change performs none of those marketplace writes and does not implement
payment replay/timeout reconciliation.

## Verification and remaining work

`test/okx-provider.test.mjs` exercises a real MCP HTTP client, durable SQLite
queue, coordinator, measurement planner and deployment approval logic. Model,
GitHub source and cloud execution are controlled fixtures. Tests cover the full
journey, duplicate requests, stale approvals, cross-caller reads/writes, revocation,
malformed inputs, unavailable results, unsupported runtimes and interrupted analysis.

Use `node scripts/okx-provider-smoke.mjs /private/client.json WORKFLOW_ID` for
read-only HTTPS/MCP checks against an existing deployment. It compares the old
API and new interface for every cohort and prints no credentials or feedback text.
Add `--intake` to submit one fixed public demo repository without business inputs,
stopping at questions before model calls or deployment.

Next comes the verified marketplace task connection and payment accounting,
followed by real testers. Hosting has no automatic expiry or hard currency cap.
A one-off fee must not imply that ongoing hosting, model usage or tester rewards
have already been paid for.

No LaunchLab issue or linked specification was found in the refreshed Stardive
Linear/Notion portfolio; its delivery state remains unchanged. Local tests and
hosted checks do not establish a canonical Done status or CI evidence for these
uncommitted changes.
