# Founder interface and proposed OKX service

19 September 2026. Design prototype, not a release or listing claim.

## Product decision

The founder starts with a GitHub repository URL. LaunchLab should inspect the source, choose a compatible deployment framework and host, ask for missing information, and return a preview. A founder should not configure MCP, select a model, or manually translate build logs. Settings remain optional. The user previously chose one LaunchLab-managed demo hosting account.

The interactive prototype lives in the sibling `launchlab-founder-demo` checkout. It is a separate private Sites preview, preserving the existing marketing website and operator UI. It uses no real LLM, GitHub integration or deployment adapter. It never connects the public internet to the local operator API.

Private preview: https://launchlab-founder-demo.tey-jia-ye.chatgpt.site

Published 19 September 2026 at 08:11 UTC, version 1, source `056bb36fc9172654d4f1ee2ee5e03d0ee57b515b`. Sites deployment `appgdep_6aae43b8f10081919e8175e803e77fe3` reported success. Live HTTP verification confirmed the expected page, exact JS/CSS/SVG asset bytes and JavaScript MIME types, and anonymous access was denied (403). Syntax and state-flow smoke checks passed. Browser interaction/visual QA was not requested or performed; optional WebMCP hooks remain unverified because no supported validation context was available.

## Journey

1. **Connect:** paste a GitHub URL or choose the fictional PROOF / REPS example. A private-repository toggle demonstrates the access step without requesting credentials.
2. **Prepare:** walk through simulated inspection and answer one product question: what should the first visitor try? Framework settings are optional; recipes cover Next.js, React/Vite, React/Vinext and static sites. They are suggestions, not detected facts or a claim of general hosting support.
3. **Review:** show source, goal, framework, proposed host/account and preview scope. The mock has no charges; a live service must show actual costs and use the caller's existing authorization or obtain approval for that specific plan.
4. **Launch:** display build/readiness progress. Current steps are labelled simulation. A connected service must render provider evidence, not progress timers presented as real work.
5. **Handoff:** return a plan download. The existing PROOF / REPS storefront is a clearly separate example, not a new deployment. Real tester recruitment, incentives and commerce are subsequent authorized workflows.

## What the agent should handle

Infer framework, package manager, build/output configuration and a compatible host from actual repository evidence. Pin a commit and return the plan before execution. Ask only when the evidence does not resolve a decision: private repository access, multiple application roots, missing secret names, external service prerequisites or spending beyond an approved limit. Secrets go through a secure host form; the model sees a completion reference, not secret values.

Keep job state and execution in the backend. The GPT coordinator reads status, asks questions and requests typed tools. A worker performs builds and persists status independently of the chat session. Every job has an owner, a plan digest and an idempotency key. Edited source/configuration invalidates the reviewed plan. Repository text is untrusted input and cannot authorize tools or spending.

## Existing implementation to reuse

- `src/deployment-preflight.mjs` already inspects normal repositories read-only. Integrate that actual evidence into the prepare screen first; do not reuse this prototype's fictional inspection as evidence.
- `src/runs.mjs` provides plan/confirmation/status patterns, but its current execution prepares supported **local static previews** and demo-credit campaigns. It does not deploy arbitrary applications.
- `src/mcp.mjs` exposes existing capabilities to an external agent. A GPT-backed server can adapt those capabilities to function calls; it needs its own configured API access, authentication and execution limits.
- The hosted PROOF / REPS app is a manually deployed example with its own HTTPS API and D1 state. LaunchLab has not automatically deployed it or linked its feedback to a core campaign.

## Moving to OKX AI

Keep one service backend and two clients: the founder website and an OKX buyer agent. The website is not uploaded into OKX AI. Register a service that calls the backend and returns structured results.

**First integration: deployment inspection.** Publish a narrowly scoped, free HTTPS endpoint that accepts a public GitHub repo URL and returns pinned-source evidence, a proposed framework, blockers and questions. Add bounded requests and SSRF restrictions. An actual successful buyer-agent call and accepted service/integration URL are the completion evidence. This is useful before deployment execution is ready. [Official A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp), reviewed 19 September 2026.

**Managed launch: persistent task.** After provider deployment works, expose authenticated operations to plan, answer missing questions, approve/start, and read a job. These are proposed application contracts, not official OKX schemas:

| Operation | Input | Result |
| --- | --- | --- |
| Inspect / plan | repo URL, goal, caller identity | source commit, plan ID/digest, questions, supported recipe, cost estimate |
| Supply answers | owned job ID, structured answers, secure connection references | revised plan or readiness status |
| Start | owned job ID, approved plan digest, budget authorization, idempotency key | stable job ID and status URL |
| Read status | owned job ID | phase, blocker/question, build evidence, eventual deployment URL |

For the complete launch service, evaluate OKX's A2A non-subscription task model: one requested outcome, agreed fee, delivery and settlement. Our proposed deliverable is an accessible preview URL, pinned commit, build record and readiness report. Persistent job handles and follow-up interactions must be validated against the actual marketplace integration. Do not assume an x402 HTTP request stays open throughout a build or feedback campaign. [Official A2A guide](https://web3.okx.com/onchainos/dev-docs/okxai/a2a-no-subscription), reviewed 19 September 2026.

x402 can later meter short completed operations. Status polling must not unintentionally charge repeatedly or start duplicate jobs. A service fee, hosting costs, store checkout and tester incentives are separate amounts with separate authorization and accounting. A testnet payment proves only payment plumbing; it does not prove marketplace registration or a managed launch.

## Concrete next implementation sequence

1. Validate this mock with the founder; use its flow as the frontend contract.
2. Connect actual repository inspection and secure GitHub authorization.
3. Implement one deployment provider and a tightly supported framework set in the selected demo account; preserve logs, versions, ownership and resumable status.
4. Add the GPT coordinator and backend enforcement, using real tool outputs for every status claim.
5. Register the useful free inspection service and demonstrate a buyer-agent call. Expand to managed launch delivery once it works end to end.

No Linear issue or Notion specification for LaunchLab was found in the live Stardive portfolio refresh. This document does not change unrelated portfolio statuses.

## Follow-up feasibility check: expose the complete workflow

Research conclusion on 19 September 2026: the complete managed launch is a plausible **A2A single-task service**. A free inspection-only A2MCP listing remains an optional incremental release, not a prerequisite or the final product. LaunchLab executes builds on its own infrastructure/provider account; an OKX provider runtime handles marketplace communication and calls that backend. Publishing this static mock alone cannot supply the service.

The [official A2A guide](https://web3.okx.com/onchainos/dev-docs/okxai/a2a-no-subscription) documents custom delivery programs, ongoing task status and submission of text/files. Its A2A registration schema omits an HTTP endpoint; this differs from registering an A2MCP API. The [buyer guide](https://web3.okx.com/onchainos/dev-docs/okxai/user-buy-service) places requirements and follow-up in the buyer's agent conversation. The founder website can remain the secure connection and detailed progress surface.

Inspection of OKX's public source at commit `2f8abd5e0adcf105e54ee39a48ce0815506a7200` establishes more precise interaction support:

- [Parameter clarification](https://github.com/okx/onchainos-skills/blob/2f8abd5e0adcf105e54ee39a48ce0815506a7200/skills/okx-ai/references/a2a/params.md): missing declared inputs can be requested before acceptance; later questions can clarify execution without changing commercial terms. The buyer's agent can relay a question to its owner and return the answer. This is source evidence, not a tested live round trip.
- [Provider assignment](https://github.com/okx/onchainos-skills/blob/2f8abd5e0adcf105e54ee39a48ce0815506a7200/skills/okx-ai/references/a2a/provider/assignment.md) and [implementation](https://github.com/okx/onchainos-skills/blob/2f8abd5e0adcf105e54ee39a48ce0815506a7200/cli/src/commands/agent_commerce/task/asp/provider_decision.rs): newer designated-provider tasks use accept/need-parameters/reject decisions. Marketplace decisions belong in the provider runtime, not dashboard handlers.

**Documentation drift:** the web guide describes the older apply/price/invoice progression, while the current source describes funded designated tasks and provider-acceptance commands. Do not combine these playbooks. Pin the installed CLI/runtime and validate its actual events, task detail and returned actions before making financial writes. This research installed nothing, registered no identity, sent no peer messages and moved no funds.

### Proposed acceptance test

Use one supported, public, secret-free example repository in the chosen demo hosting account. A buyer agent selects the registered LaunchLab service with repository URL, desired outcome and an explicit bounded scope. The provider asks one intentionally omitted business question through the real task channel; the buyer answers. The provider then invokes our worker, produces an actual accessible preview, and delivers its URL with commit and build/readiness evidence. Restart the worker once and verify that the same job resumes without duplicate deployment. Confirm the marketplace records the delivery. Perform settlement only under the authorized amount and network.

Private GitHub access should use a job-bound LaunchLab authorization page. A login/access step cannot be replaced by the model guessing credentials. After acceptance, new billable scope requires separate authorization and a protocol-supported new task/change rather than silently changing the original terms. Tester recruitment and incentive payment are separate follow-on work; OKX task discovery does not establish an available human tester pool.

The biggest remaining work is the actual deployment worker, secure connection handling, durable job state and provider runtime. The marketplace's documented task/clarification features fit the desired experience, but no live LaunchLab buyer/provider round trip has been verified.
