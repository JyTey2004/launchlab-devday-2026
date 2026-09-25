# LaunchLab

[Watch the 2:48 product film](https://jytey2004.github.io/launchlab-devday-2026/video.html)

[Open the public judge walkthrough](https://jytey2004.github.io/launchlab-devday-2026/) · [Source checks](https://github.com/JyTey2004/launchlab-devday-2026/actions)

**Give your agent a repository. Get a live experiment and evidence about what people tried.**

LaunchLab is an OKX Dev Day prototype for founders testing web products. It detects a supported GitHub app, proposes measurement hooks and feedback questions, asks for approval, builds an isolated copy, and returns an AWS Amplify preview. Agents can retrieve progress and measured results over HTTPS/MCP.

## Start here

- [LaunchLab website](https://launchlab.stardive.xyz/)
- [Judge walkthrough](docs/submission/judges.md)
- [Build-period changes and evidence](docs/submission/build-period.md)
- [PROOF / REPS example source](https://github.com/JyTey2004/launchlab-proof-reps-public-demo)
- [Provider API and nine MCP tools](docs/okx-provider-interface.md)

This repository is a reviewed submission snapshot exported from the development checkout. It excludes private environment files, databases, credentials, deployment-account configuration and operator logs. The export manifest records every included file's hash. Snapshot history starts at export; it is not a fabricated reconstruction of earlier development commits.

## What is implemented

1. Resolve a public GitHub repository to an exact commit; inspect framework and build configuration.
2. Ask for missing validation goals, audience and app-folder details.
3. Use server-side GPT to propose constrained tracking edits and contextual feedback questions.
4. Bind approval to the exact plan and source revision.
5. Run the build in AWS CodeBuild, deploy a preview with Amplify, and verify its assets.
6. Collect opt-in events and voluntary feedback; distinguish repeat actions, sessions and audience labels.
7. Return status, results and evidence-based analysis through HTTP/MCP or the founder dashboard.

The live PROOF / REPS exercise used real model calls, AWS builds, hosting and collection. Its checkout is simulated, and its recorded QA is not evidence of customer demand. Source edits are applied to a disposable build copy; LaunchLab does not write to the customer's GitHub repository.

## OKX integration status

As of 25 September 2026, LaunchLab provider **13905** is registered with a free **Launch and Validation Pilot** A2A service but its listing review was rejected because the review task went unanswered for more than 20 minutes. The local provider communication runtime passed all eight readiness checks again, but this does not establish successful task handling. The hosted MCP interface is live and was exercised with a real client.

**The complete OKX buyer-task-to-delivery round trip remains unverified.** A backend MCP response is not a marketplace delivery receipt. Status will be updated only after that test succeeds. See [registration](deploy/okx-registration-evidence.json), [listing submission](deploy/okx-listing-evidence.json), and [backend verification](deploy/okx-provider-evidence.json).

The separate readiness-report endpoint has a verified **0.01 test USD₮0** x402 self-payment on X Layer Testnet. This is not deployment billing, third-party revenue or a reward payout. [Payment evidence](deploy/launchlab-seller-testnet-payment-evidence.json).

## Run locally

Requires Node.js 22.13+ and npm. Python 3 is needed for managed archive/collector tests.

```sh
npm ci --ignore-scripts
npm start
```

Open `http://127.0.0.1:4310/agent` for the validation-agent interface or `/app` for the original local experiment prototype. The independent preview origin is port 4311. Local state is stored in ignored `.data/`.

Copy `.env.example` to `.env` and provide your own `OPENAI_API_KEY` only if you want real model calls. Keep keys server-side. Local examples and tests do not require a key. Cloud deployment is opt-in, requires your own AWS configuration and incurs hosting/build/model costs. No deployment starts merely by cloning or running tests.

```sh
npm run check
npm test
python3 -m unittest discover -s test/managed -p 'test_*.py' -q
```

On 25 September, 108 JavaScript tests, 19 Python tests and syntax checks passed in the development checkout. The tests use controlled model/cloud fixtures. Live evidence is identified separately; inspect this repository's CI for verification of its actual commit.

## Code map

| Area | Location |
| --- | --- |
| Workflow, GPT contracts and reviewed edits | `src/agent/` |
| Isolated builds, instrumentation, collection and reports | `src/managed/` |
| Authenticated tenants and durable jobs | `src/hosted/` |
| Provider HTTP/MCP adapter | `src/okx/` |
| Bounded x402 readiness seller | `src/seller.mjs` |
| Founder interface and website | `web/` |
| Regression tests | `test/` |

## Scope and limits

Supported deployments are public static HTML and supported Vite/npm frontends. Private GitHub authorization, arbitrary servers/SSR, application secrets, automatic tester recruitment, incentive payouts and deployment billing are unfinished. The provider communication process currently runs on the operator's Mac. Hosting continues until an operator removes it; there is no automatic expiry or hard currency spending cap.

The prototype's demo credits have no cash value. Sessions are browser visits, not verified unique people. Generated code, repository text and submitted feedback are treated as untrusted input. Do not put credentials in prompts, public issue text or the submission form.
