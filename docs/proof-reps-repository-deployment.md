# PROOF / REPS: real repository and hosted demo

19 September 2026. The user requested a dummy repository, similar to PROOF / REPS, and an actual deployment.

Later on 19 September, the user requested a non-Sites host with an included preview URL. The preferred demo URL is now https://proof-reps.d3hkjkabjo1i7k.amplifyapp.com on AWS Amplify. Job 1 succeeded and all seven built files matched over HTTPS. The original private audience is preserved with password protection pending the user's optional public-access choice. See [the Amplify deployment record](../deploy/proof-reps-amplify/README.md). The source commit and private GitHub repository are unchanged.

## Delivered artifacts

- Private GitHub repository: https://github.com/JyTey2004/launchlab-proof-reps-demo
- Owner-private HTTPS storefront: https://proof-reps-repo-demo.tey-jia-ye.chatgpt.site
- Local source: `/Users/teyjiaye/Desktop/stardive/launchlab-proof-reps-demo`
- Source commit: `478fd89280e407ca978c6c3425014901f70dc68e`.
- Successful GitHub build: https://github.com/JyTey2004/launchlab-proof-reps-demo/actions/runs/35433172674
- Sites project: `appgprj_6aae4c161b408191bf8fc711de38f99e`.
- Saved version: `appgprj_6aae4c161b408191bf8fc711de38f99e~appgver_1e89f3b3abc88191aa29aab983ea6f58`.
- Successful deployment: `appgdep_6aae4dbbd72481918da652c63ed39003`, reported at `2026-09-19T08:54:35.089482+00:00`.

## Current experiment extension — 19 September 2026

The preferred AWS demo now includes opt-in interaction collection, persistent voluntary feedback and a private founder report at https://proof-reps.d3hkjkabjo1i7k.amplifyapp.com/results.html. The original Sites deployment remains unchanged.

Source: `d7d209c4d76e346ab4ba49310bd9a2eb508b6e31`; [passing CI](https://github.com/JyTey2004/launchlab-proof-reps-demo/actions/runs/35435767902). Amplify job `2` reached `SUCCEED` at 09:50 UTC. The collector stack is `launchlab-proof-reps-observation`; its endpoint is https://ylxtccmo36.execute-api.ap-southeast-1.amazonaws.com. No collector credentials are in the frontend.

The report distinguishes infrastructure requests from opted-in sessions; shows product interest, a simulated checkout funnel, purchase intent, preferred payment, selected objections and comments; and suggests a next experiment. Incentivized, agent and internal-test activity are filtered separately from unrewarded people. These labels do not verify identity or prevent fabricated responses. There is no real payment or reward settlement.

The private founder key is saved in ignored `.data/proof-reps-amplify/founder-report-access.json`. Store access remains password-protected. Local checks cover store totals, client consent, report authorization, persistent data types, deduplication, cohort separation, input validation and failure handling. Live internal-test event/feedback writes and report readback passed, including AWS metrics; no organic responses were seeded. Browser visual/click QA and native WebMCP execution were not performed.

This is a single-project deployment of the collection service. The core LaunchLab agent does not yet automatically provision this backend for arbitrary repositories. The next integration is project-specific experiment configuration and an authenticated results deliverable attached to each deployment.

## Original product scope (initial Sites release)

A one-page Vite/vanilla-JavaScript gymwear storefront with three illustrated products, size selection, a memory-only shopping bag, removal, correct quantity/totals and simulated checkout. Prices and inventory are fictional. No wallet connection, crypto transfer, real purchase, shipping collection or traction analytics exists. The generated product imagery is reused from the earlier authorized PROOF / REPS example.

The dummy repo and preview are separate from the earlier persistent `proof-of-reps-store` application and the `launchlab-founder-demo` UI. Those sites were not changed.

## Repository inspection

The actual LaunchLab inspector read this private repository at the recorded SHA using the operator's authenticated GitHub credential, passed only through the child process environment. No credential was printed, saved in the repo, added to a Git remote URL, or passed as a tool request field.

Result: `inspection_complete`; Vite; npm; Node `>=22.12.0`; root `.`; no environment names or external-service questions. Proposed commands: `npm ci`, `npm run build`; candidate output: `dist`. The full secret-free result is retained locally at `/tmp/launchlab-proof-reps-inspection.json` (temporary, not durable storage).

The inspector currently suggests Vercel for this supported framework. For this actual demo, the operator selected Sites static hosting, built the authored source and deployed its verified `dist` output. Both the GitHub source and Sites source remote carry the same commit. This is real repository inspection, a real build and a real HTTPS deployment, but **not execution by an implemented LaunchLab managed-hosting adapter**. That adapter and an OKX AI listing remain separate work. The inspector's `canDeploy: false` flag was not overwritten to manufacture end-to-end automation.

## Verification and access

The local Vite production build passed, as did GitHub Actions for the exact source commit. A focused local check verified bag merging and totals, invalid-size rejection and the existence of every built asset/product image. The hosting service reported a successful private publication; source checkout is clean and GitHub visibility is PRIVATE. Sites access was confirmed as one owner and no external visitors. The authenticated live HTML returned HTTP 200 with the correct storefront; all six image/icon/CSS/JavaScript assets returned HTTP 200 and matched the local build byte-for-byte. Anonymous access returned HTTP 401 as expected for the private preview.

No browser screenshots or interaction QA were requested or performed. The optional, feature-detected WebMCP surface shares the UI state (`read_demo_store`, `add_demo_item`, `complete_demo_checkout`), but no supported WebMCP validation context was available; browser-agent integration remains unverified. Ordinary page use does not depend on that API.

The local development server was used only for preview and should be stopped after the hosted handoff. The deployed site does not depend on the local server.

No matching LaunchLab issue/spec exists in the refreshed Stardive Linear/Notion records. Unrelated canonical issue states and Slack conversations were left unchanged.
