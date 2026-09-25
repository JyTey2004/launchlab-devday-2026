# GPT validation agent

LaunchLab can prepare a product-specific measurement plan, add bounded tracking hooks to a disposable source copy, deploy it through the existing AWS pipeline, collect voluntary feedback, and ask GPT to summarize the resulting evidence.

The operator UI is **http://127.0.0.1:4310/agent**. It is a local workspace, not a public customer portal or an OKX AI listing.

External agents can now use the [persistent workflow API](agent-workflows-api.md)
for intake, missing answers, plan approval, progress, preview access and results
without operating that dashboard. The original experiment tools below remain
available; the workflow coordinator adds revision checks and explicit recovery.

## Finish setup

Setup has already created the private `.env` file in this checkout, preserved the existing operator settings, and added an empty key field. It is excluded from Git and has owner-only filesystem permissions.

1. Open `/Users/teyjiaye/Desktop/stardive/okx-launch-lab/.env` locally.
2. Fill in `OPENAI_API_KEY=` with your OpenAI API key. Do not put it in frontend code, a `VITE_` variable, a GitHub commit, or a chat message.
3. Restart the LaunchLab server from this directory with `npm start`. Stop its existing process first, or ask Codex to restart it after saving the key. Environment changes are not loaded by a running process.
4. Open `/agent`, choose **Use PROOF / REPS example**, then **Create experiment plan**.

The configured model is `gpt-5.4-2026-03-05`; change `LAUNCHLAB_OPENAI_MODEL` if the account requires a different compatible model. Having a key configured does not prove billing or model access: the first actual request verifies that.

For another checkout, run `npm run setup:ai` once. It preserves existing values. Existing GitHub read access and the AWS configuration described in [the managed pipeline guide](reusable-amplify-pipeline.md) are also required. The current demo account is already configured locally.

## Founder journey

1. Give LaunchLab a GitHub URL, project name, learning question and intended audience. Optional settings select a ref and app folder.
2. LaunchLab pins the source commit and checks whether the framework is supported. Unsupported builds stop with questions before a model call.
3. GPT receives the brief and a bounded selection of frontend files. It proposes 1–8 event definitions, an ordered list for cumulative reach, 1–3 neutral feedback questions and exact source anchors.
4. Review the proposed events, questions, source changes and limitations. Planning alone does not create hosting resources.
5. **Deploy this experiment** starts the existing CodeBuild → Amplify flow. The worker applies the reviewed edits, performs the build, and records source hashes. LaunchLab compares the worker's instrumentation report with the reviewed plan before publishing.
6. Open the password-protected preview using credentials in the displayed private local file. Use `?test=1` for internal checks or `?actor=agent` for agent testing. Invite actual testers separately; they can decline tracking and still submit feedback.
7. Review actions, cumulative reach, answers and comments. Filter unrewarded, incentivized, agent and internal-test cohorts.
8. Choose **Analyze this evidence with GPT**. The result separates observed behavior, respondent statements and suggested next experiments, with references to the supplied evidence. Empty cohorts make no model call; unchanged evidence uses its cached analysis.

The example uses the initial PROOF / REPS storefront commit, `478fd89280e407ca978c6c3425014901f70dc68e`, before its old custom analytics were added. This avoids two feedback widgets. Its checkout is simulated; actions indicate interest, never verified purchases.

## What the code agent can change

This first implementation deliberately supports two concrete extensions:

- Add registered `globalThis.LaunchLab?.track("event_id")` calls at exact JavaScript statement boundaries, or a `data-launchlab-event` attribute on a literal HTML control.
- Configure LaunchLab's existing consent, feedback and reporting components with product-specific events and questions.

GPT does not supply arbitrary executable patches, dependencies or backend implementations. The application compiles its structured proposal into fixed tracking insertions. A missing, ambiguous or modified source anchor blocks the edit. Every plan is bound to its source revision and content digest.

Edits currently apply to the isolated build copy. **They are not pushed to the founder's GitHub repository.** The saved plan and build evidence make the changes reviewable. A future PR workflow needs repository write authorization and should retain the same review record. The build-package doctor remains deterministic; GPT is responsible for experiment design and evidence interpretation, not unrestricted package upgrades.

An exact anchor and a successful build do not prove the model chose the best measurement location. Check the preview's actual behavior before inviting testers.

## Data and execution boundaries

- The OpenAI key stays in the operator process. It is not included in the source archive, CodeBuild job, Lambda collector, browser configuration or MCP response.
- Source selection excludes hidden files and known build/backend folders. It sends at most 30 frontend files, 60,000 characters per file and 160,000 total characters. Visible credential-pattern checks are a precaution, not a complete secret scanner. Only submit repositories you may share with OpenAI.
- Requests use the [Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), `store: false`, low reasoning effort and a 6,000-output-token cap. This setting does not imply a special zero-data-retention agreement.
- The selected [GPT-5.4 snapshot](https://developers.openai.com/api/docs/models/gpt-5.4) is configurable. Planning permits at most two calls: one proposal and, when necessary, one correction of invalid anchors. Network failures do not trigger automatic retries. These limits are not a dollar spending cap.
- Summary requests use aggregate facts plus a limited selection of comments and free-text answers. Email addresses, wallet-like hex strings, URLs and OpenAI-key patterns are removed before model analysis. This is basic redaction, not guaranteed anonymization of names, phone numbers or all personal information. The form tells respondents to omit personal information and discloses AI summarization.
- No product events are sent before tracking consent. Only registered event names are accepted; no typed inputs, arbitrary event properties, raw error messages, wallet data or contact fields are collected by the SDK. Voluntarily submitted feedback is stored separately from tracking consent.
- Reach counts opted-in browser sessions, not verified unique people. The updated tracker separately records repeated actions using occurrence IDs; retries of the same ID within a session count once. Older session-only records cannot recover earlier repeat counts. Cumulative reach means a session contains all preceding events; it does not establish their chronological order or explain abandonment. See [dashboard and counting update](dashboard-counting-update.md).
- Cohort labels and incentives are self-reported, not verified identity or Sybil resistance. This agent does not recruit users, distribute rewards, collect crypto payments or create an OKX listing.
- Model citations are constrained to available evidence IDs in the response schema and checked again against their observed/reported category. Their presence does not establish that every model interpretation is correct. Product recommendations are withheld for internal-test and agent cohorts, including cached analyses. Small samples and stated intent are not proof of demand.
- Each experiment gets its own deployment and collector configuration. Version mismatches are rejected. Records expire after 90 days. The public configuration contains event labels, questions, limitations and the source SHA; never include confidential material in those fields.

## MCP and CLI

Five new MCP tools use the same server-side implementation:

| Tool | Purpose |
| --- | --- |
| `launchlab_plan_experiment` | Inspect source and request a GPT measurement plan |
| `launchlab_get_experiment` | Read the plan, proposed edits and deployment progress |
| `launchlab_start_experiment` | Deploy the exact plan digest after scope review |
| `launchlab_experiment_report` | Read measured actions and submitted feedback |
| `launchlab_analyze_experiment` | Request or retrieve an evidence-based GPT summary |

The MCP client needs `LAUNCHLAB_URL` and the private `LAUNCHLAB_API_TOKEN` for the local server. It does not need the OpenAI key. HTTP endpoints are under `/api/agent/`; they are protected by the existing loopback operator/same-origin or bearer-token checks. Do not expose this operator server publicly.

```sh
# Configuration status only; no model call.
npm run agent:validate

# Billable GPT planning, no AWS resources yet.
npm run agent:validate -- --brief examples/proof-reps-validation.json

# Read the saved plan, then deploy its reviewed digest.
npm run agent:validate -- --status EXPERIMENT_ID
npm run agent:validate -- --deploy EXPERIMENT_ID --digest PLAN_DIGEST

# Read internal QA separately from real users.
npm run agent:validate -- --report EXPERIMENT_ID --cohort test
npm run agent:validate -- --analyze EXPERIMENT_ID --cohort organic
```

Repeated planning with the same request key returns its saved result. It does not automatically retry a blocked plan. Correct the blocker and use a new key for a deliberate new attempt. The UI generates a new key for each submitted brief; repeated submissions are new billable plans.

State lives in ignored `.data/experiments/exp_…/`: plan, instrumentation, source snapshot, provider receipts and cached summaries. Deployment artifacts remain in `.data/managed/dep_…/`. Private preview passwords and report keys stay in the corresponding `founder-access.json` file.

## Recovery and current limits

- Supported deployment targets remain npm/Vite static frontends and plain static sites. SSR, arbitrary services, workspace builds, private package credentials and runtime secrets need further adapters.
- A plan lock or summary lock prevents concurrent paid work. After an interrupted operator process, inspect the saved attempt and confirm the old process has stopped before removing a stale lock. A lost provider response is not automatically retried because it may already have been billed.
- AWS hosting continues until explicitly removed. This implementation does not add automatic expiry, a hard spending cap or billing to customers. Existing Amplify publish/recovery limits are documented in the managed pipeline guide.
- No model-driven self-repair loop deploys repeated speculative changes. A failed build produces evidence for another reviewed attempt.

## Verification on 20 September 2026

All 75 Node tests and the 10 Python checks invoked by the suite pass. JavaScript syntax checks also pass. Verification covers missing-key behavior, the strict Responses request, refused/incomplete responses, pinned plans, bounded correction attempts, source matching, real worker execution, collector versioning, consent, dynamic feedback validation, cohort separation, MCP integration, bounded summary references, caching and withholding product recommendations from QA.

The actual SDK and feedback widget were also exercised in a browser against the Python collector with in-memory persistence: one internal test session, one product action and one saved feedback response; zero organic sessions or responses. The manual fixture is `python3 -B test/managed/widget-smoke.py`; it accepts only test actors and creates no cloud resources.

**Live verification completed after the user supplied the key:** GPT-5.4 generated a plan in one call, and the existing AWS pipeline applied its edits to `index.html` and `src/main.js`. CodeBuild passed, Amplify published, and authenticated HTTP verification matched all 15 hosted files. The new protected preview is [PROOF / REPS validation](https://preview.d3g0puchww8hfn.amplifyapp.com). The [founder dashboard](http://127.0.0.1:4310/agent#exp_8dd2a27b024dbf60c078) shows the plan and reports.

The live collector saved one explicitly synthetic API test session, all three events and one feedback response. Repeating the request did not duplicate feedback or create another build/publish job. Organic sessions and responses remain zero. GPT analysis succeeded, and repeated analysis used the saved result without another model call. The empty organic cohort made no model call.

The first summary was rejected for an unsupported evidence reference. After restricting the response schema to actual evidence IDs, a second analysis passed. GPT's QA-based product suggestions are withheld by application policy. Three live model requests were made in total (one plan, two analysis attempts); token usage for the rejected attempt was not retained. A transient CloudFormation status-request failure was recovered by resuming the same completed stack, with no extra environment.

The in-app browser reported `ERR_BLOCKED_BY_CLIENT` when opening the protected Amplify preview. **Remote browser interaction remains unverified.** Hosted bytes, private-access checks and the live collector were verified through HTTP; the earlier local browser fixture remains separate evidence. Preview credentials are in the ignored `.data/managed/dep_8dd2a27b024dbf60c078/founder-access.json` file.

[Non-secret deployment and inference evidence](../deploy/gpt-proof-reps-evidence.json). The older PROOF / REPS and NIGHT PASS deployments were not replaced. Source GitHub repositories were not written. Local verification does not replace a new GitHub CI run for this uncommitted work.
