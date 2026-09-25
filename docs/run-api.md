# One experiment run: API and agent contract

Implemented locally on 17 September 2026. This is the backend contract for connecting a future website flow and the existing MCP client. The current landing-page brief builder remains planning-only and is not automatically connected to these endpoints.

One persistent run connects a learning goal, pinned project, preview release, campaign and feedback report. The caller supplies the mission and judgment; this service does not contain an autonomous reasoning model. Existing lower-level project/campaign APIs remain available.

## Plan → confirm → prepare → collect → learn

| Operation                   | HTTP                          | MCP                                                                      |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| Prepare a plan              | `POST /api/runs`              | `launchlab_plan_run`                                                     |
| Execute its confirmed scope | `POST /api/runs/:runId/start` | `launchlab_start_run`                                                    |
| Read progress and evidence  | `GET /api/runs/:runId`        | `launchlab_get_run`                                                      |
| List run summaries          | `GET /api/runs`               | Available through the HTTP API; full stored runs also appear in overview |
| Stop new reservations       | `POST /api/runs/:runId/close` | `launchlab_close_run`                                                    |

Same-origin browser mutations send the origin; remote/local agent clients can use the configured bearer token. The existing API still binds to loopback and has no public multi-user identity boundary. This contract does not make it suitable for public exposure.

### 1. Plan

Example request, omitting `repoUrl` to use the bundled example:

```json
{
  "requestKey": "my-first-test-v1",
  "title": "First use of the agent directory",
  "goal": "Can a new builder understand what happens after preparing a request?",
  "audience": "First-time X Layer builders",
  "task": "Choose a service, prepare a request and describe the first confusing step.",
  "participants": 3,
  "budget": 31
}
```

Optional `repoUrl` and `ref` use the existing public GitHub static-package importer. A ref without a repository is rejected. Planning validates the source and atomically stores its project and run; it does not write preview artifacts or open a campaign. A later start rechecks the pinned source digest.

`requestKey` is required (8–100 characters: letters, digits, `.`, `_`, `-`). Reuse it for network retries. The same validated brief returns the original run without fetching a moving ref again. Reusing the key with a different brief returns 409. Use a new key for a changed scope, source version or retest. Failed inspection does not create a run.

`participants` is the target number of accepted submissions, 1–100. It does not establish unique humans. `budget` is an integer demo-credit cap, 1–100000. The per-submission reward is `floor(budget / participants)` and must be 1–10000. The campaign receives exactly `participants × reward`; the remainder is unallocated. The example therefore proposes a 30-credit pool, 10 per accepted submission and 1 unallocated credit within a 31-credit cap. No fee, real payment or blockchain transfer occurs.

The result includes `id`, `status: "planned"`, `plan`, `planDigest`, source project, progress, links, timeline, limitations and `nextAction`. Display the returned plan, not just the input form: pinned source, local environment, mission, audience, target, allocation, eligibility and deliverable.

### 2. Start the exact plan

```json
{ "planDigest": "<the 64-character digest returned by planning>" }
```

The digest binds the source, mission, environment and cost allocation. It is a scope-consistency check, **not** a user signature, identity credential or proof of authorization. The calling agent checks the user's existing authorization or presents the plan before calling start. The demo script explicitly authorizes only its fixed local demo.

Start prepares the pinned static release, performs an HTTP content check, checks availability again and atomically links one campaign to the run. A successful response is normally `collecting`; it has recruited no one. Repeated starts return the existing run without allocating another pool. Simultaneous starts across database connections do not create duplicate campaigns.

Expected validation/conflict errors use 400/409. Preparation failures are persisted as a normal run response with `status: "blocked"` and `blocker.message`; **inspect status even when HTTP returns 200**. Nothing is recruited or funded after a failed preview. Restoring the prerequisite and repeating start retries the same pinned plan. Changing the scope requires a new plan.

### 3. Follow the run

| Status       | Meaning / next action                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `planned`    | Inspect the proposed scope and confirm it.                                                                                       |
| `preparing`  | Work is in progress; poll the run.                                                                                               |
| `blocked`    | Read the blocker; fix the prerequisite and retry the same plan.                                                                  |
| `collecting` | The preview and campaign exist; invite testers explicitly.                                                                       |
| `reviewing`  | At least one submission needs an evidence review.                                                                                |
| `completed`  | The target number of accepted submissions has been reached. This says nothing about human uniqueness, demand or real settlement. |
| `closed`     | No new reservations; existing sessions and reviews retain their obligations.                                                     |

After the campaign opens, progress is derived from actual feedback and campaign state. `report` contains the existing version-linked feedback, review decisions and pool accounting. `progress.verifiedHumanParticipants` is `null`, because aliases cannot establish that fact. `report.summary.demandValidated` remains false.

`links.status`, `links.workspace`, `links.experiment` and `links.report` are relative to the operator origin. The preview is an absolute URL on the isolated local preview origin. The workspace can display the project's release and campaign today; a dedicated run screen is not yet implemented. Polling creates no new work or service charge.

### 4. Review or close

Use the existing `launchlab_review` after reading the original evidence. A low rating or useful blocker remains eligible. Existing reserve/submit/review endpoints drive run progress. Submitted evidence retains its reserved demo reward during review.

Closing a run stops new reservations and preserves all existing sessions, feedback, ledger entries and obligations. It is idempotent. A closed run cannot be started again. A preparing run must finish or be recovered before closure; there is no mid-I/O cancellation in this version.

## Persistence, interruption and limits

Runs use the existing SQLite state transaction. Project/run creation, release/attempt linking and campaign/run linking each commit atomically. Existing databases without a `runs` field are supported without replacing their data.

Preparation executes in the API process, not a durable background queue. A start response can be lost while work continues. Poll before retrying. Active attempts have a ten-minute lease; their status response exposes `retryAfter`. If the process was interrupted, retry start after that timestamp. An incomplete attempt receives a new release; a previously verified release is rechecked and reused. Attempt identifiers prevent a delayed earlier worker from attaching another campaign or overwriting a later result. The service does not automatically wake or resume work after a restart.

Public hosting/accounts, actual recruitment, participant identity, impartial review/appeals, agent synthesis, OKX order handling and payment settlement remain separate milestones. The local run endpoints do not claim any of those integrations.

## Verification

`npm run check` and `npm test` cover the full existing suite plus planning/confirmation, retry keys, cap arithmetic, concurrent starts across database connections, preview failure/recovery, expired-attempt fencing, feedback-derived progress, closure obligations, HTTP boundaries and official MCP client calls.

`npm run demo:agent` uses the run workflow against a running local server. It reuses the request key `launchlab-agent-demo-v1`; set `LAUNCHLAB_DEMO_REQUEST_KEY` to a new value for an intentionally separate demo. It creates a preview and campaign, but no synthetic tester feedback.
