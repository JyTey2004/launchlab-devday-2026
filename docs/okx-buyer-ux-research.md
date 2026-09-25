# OKX AI buying experience and LaunchLab website plan

Observed on 17 September 2026 through the live public website. This is a UX walkthrough, not a completed purchase. No service request, account registration, wallet authorization, installation or payment was submitted.

## Main finding

On all four service listings inspected, **Use now opened a prompt-copying dialog**. It did not open an on-page task form or checkout. The dialog told the visitor to install Onchain OS through their own agent if necessary, then copy a short service-selection prompt into that agent.

The prompt identifies a service by name and service ID. It does not include the user's project, task, budget or deadline. This makes the transition from browsing to the agent conversation a central design problem for LaunchLab.

These observations describe the public entry flow tested here. They do not establish every possible signed-in experience or the behavior of every listing.

## Observed listings

| Listing | Service inspected | Displayed price at inspection | Result of selecting Use now |
| --- | --- | --- | --- |
| [Sage](https://www.okx.ai/agents/9211) | Live page check, service 38766 | Free | Installation guidance, then a prompt naming the service and its ID. |
| [JuriXAI Auditor](https://www.okx.ai/agents/4964) | Repository Audit Service, service 30916 | 1 USDT/use | The same two-step prompt handoff. No payment was initiated. |
| [MistEye](https://www.okx.ai/agents/2180) | MistEye Security Gate Scan, service 17126 | 0.0001 USDT/use | The same two-step prompt handoff. |
| [ChainForge Studio](https://www.okx.ai/agents/12928) | Smart Contract Development, service 40412 | 180 USDT/use | The same two-step prompt handoff. The listing also displayed Offline. |

Displayed prices are snapshots, not quotes. A /use label alone does not establish the underlying protocol or prove that the provider is available. The service descriptions and customer reviews are provider/platform content, not independently verified delivery evidence.

For example, Sage's dialog supplied this short instruction:

> I want to use < Live page check >, Service ID is 38766.

The JuriXAI service description separately listed a repository URL and project description as required inputs. A visible customer review reported friction with a missing description parameter; that is a single unverified user report, but it illustrates why our listing, schema and prepared brief should agree.

## Where the user supplies instructions

The live [OKX user tutorial](https://www.okx.ai/tutorial/user) describes onboarding as choosing an agent client, installing Onchain OS, logging into Agentic Wallet and registering a user identity. Task requirements are then discussed in that agent client. The [official buyer guide](https://web3.okx.com/onchainos/dev-docs/okxai/user-buy-service) describes gathering a title, description, budget and deadline, selecting or matching a provider, following progress and reviewing delivery.

Observed and documented stages must remain distinct:

| Stage | Evidence |
| --- | --- |
| Browse a listing, inspect services/prices and select Use now. | Directly exercised on four live listings. |
| Receive installation guidance and a service-selection prompt. | Directly observed in each dialog. |
| Provide detailed requirements to the buyer agent. | Described in the live tutorial and official buyer guide; not exercised in an installed buyer session here. |
| Fund, receive delivery, accept/reject and settle a task. | Documented; not performed or verified in this walkthrough. |

The long-running A2A task flow and a paid A2MCP API call have different execution/payment paths. We must not present every service as following one escrow sequence. The [A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) describes the structured-result endpoint and x402 challenge/replay path; the [A2A guide](https://web3.okx.com/onchainos/dev-docs/okxai/a2a-no-subscription) describes per-task funding and delivery.

## Implication for our website

The initial website should make our capabilities understandable and prepare the user for a successful agent handoff. The proposed primary journey is:

**Understand LaunchLab → inspect an example result → prepare a test brief → copy it to your agent → review scope and cost there → follow the run and its evidence.**

Visiting OKX remains useful for checking the actual listing, service ID and displayed terms. The brief should remain available when the user visits it. We have not verified a supported deep link that pre-fills an OKX task, so the design must not depend on one.

### Homepage content, in order

1. **Clear outcome.** Explain that LaunchLab is being built to take a repo through a working environment, structured testing and version-specific findings. State who it serves.
2. **Capabilities and availability.** Distinguish the working local static-project demo from planned public deployment, human recruitment, live OKX integration and actual reward payouts. Avoid implying that planned capabilities are purchasable today.
3. **One concrete example.** Show the source version, test task, preview/sample call, feedback and resulting fix brief. Clearly label demonstration evidence.
4. **How it works.** Show the builder, LaunchLab and tester handoffs. Explain that the buyer uses their own agent for the OKX service flow.
5. **Why OKX.** Explain how commissioning, paid calls and testing an OKX-bound service fit the product.
6. **Prepare a brief.** Collect the minimum details needed for a useful request; generate an editable prompt.
7. **Practical questions.** Supported projects, what the user receives, how costs work, how to get an agent ready, tester eligibility and environment lifetime.

### Calls to action

| Product state | Appropriate action | Result |
| --- | --- | --- |
| Current prototype | Try the local demo | Opens the existing local experience with its limitations visible. |
| Planning stage | Prepare a test brief | Produces a draft the builder can review. It does not create an OKX order. |
| Verified listing exists | Use with your agent | Supplies the real service identity and a complete brief for the user's agent. |
| User wants to inspect the offer | View on OKX AI | Opens the actual verified listing while preserving the prepared brief. |
| Agent setup is missing | Set up Onchain OS | Opens the official guide. Installation and wallet setup remain explicit user actions. |

There is no verified LaunchLab listing or service ID today. Do not substitute another provider's ID, make up an ID or label a planning-only button Buy now.

### Brief fields

- Public repository URL and preferred version, with an explanation of supported formats.
- What the builder wants to learn and one concrete task to test.
- Intended audience and requested number of participants.
- Maximum total budget and currency; distinguish a demo-credit plan from actual funding.
- Desired deadline and environment/network constraints.

Only ask for additional deployment or contract details when the selected service needs them. Keep credentials out of the brief. Render user-supplied text as data and separate it clearly from the agent's operating instructions.

The prepared brief should contain the verified service name/ID when available, all required parameters, the requested deliverable and an explicit instruction to present scope and cost before making financial or publishing commitments. Once a plan is approved, routine steps within its permissions should proceed without repetitive prompts.

### Returning from the agent

The proposed service response should provide a durable run ID, status, next required action and links to the environment and findings. The website should offer the detailed evidence view; the buyer agent should summarize the same run and link back to it. This response contract still needs implementation and end-to-end verification.

Copying the prompt must not mark a run as started, funded or complete. Success is receiving a real service response with a resolvable run, not observing a clipboard event.

## Next verification before enabling a live service CTA

Use a configured buyer agent to exercise one suitable free service first, then verify the relevant paid path with explicit budget and network authorization. Observe required-parameter collection, missing-input behavior, cost presentation, cancellation, delivery format and recovery. Confirm the LaunchLab listing and its actual service ID before enabling a production handoff.

This walkthrough supports the website and UX plan. It does not authorize installations, external messages, purchases, wallet changes or public deployment.
