# Online merchant example — 18 September 2026

The user requested a simple storefront and HTTPS service adapter for a low-cost online product test.

- Store: https://proof-of-reps-launchlab.tey-jia-ye.chatgpt.site
- Owner results: https://proof-of-reps-launchlab.tey-jia-ye.chatgpt.site/results
- Audience: owner-private. The sharing preference question is unanswered; anonymous access was verified to return 401. Do not invite testers until the user chooses a broader audience.
- Source checkout: `/Users/teyjiaye/Desktop/stardive/proof-of-reps-store`, a separate Git repository with a private Sites source remote.
- Published commit: `e01454814815343c34d97a690dd9fda256903adb`.
- Site ID: `appgprj_6aac9c5e8b488191987356b22df87ed2`.
- Saved version: `appgprj_6aac9c5e8b488191987356b22df87ed2~appgver_53e08afc99d08191ae6395dbfc9bac48`.
- Deployment: `appgdep_6aaca3dac11481919b14611fceadeb37`, succeeded on 18 September at 02:37 UTC.

## Implemented

Three product mockups, size selection, expiring illustrative quotes, crypto/card/no-purchase preference, optional structured reason and written feedback, saved-response acknowledgement, an owner-only results page and JSON export. Mobile layout, accessible UI primitives and loading/error states are implemented.

The HTTPS API and storefront share D1-backed session state. Session tokens are hashed in storage; browser tokens use Secure, HttpOnly, SameSite cookies in production. Quote and decision retries are idempotent within the persisted session. Conditional version updates handle concurrent requests. Private reports require the configured owner identity or an operator API secret. The results page returns private/no-store cache headers.

The existing LaunchLab checkout now has `examples/proof-of-reps/remote-mcp.mjs` and `npm run mcp:merch:online`. This adapter keeps shopper bearer tokens inside the MCP process and marks newly opened agent sessions automated. It needs the authorized Sites access token while hosting is private. No secret belongs in prompts, repository files or this record.

## Verification and actual evidence

- TypeScript and hosted build passed.
- 22 local HTTP checks passed, including owned quotes, invalid prices and selections, session isolation, concurrent retries, origin rejection and protected reports.
- Official MCP client completed the same flow through the remote HTTP adapter; five tools were discovered and shopper tokens were not returned to the caller.
- 12 live HTTPS checks passed for the catalog, three JPEG assets, quote, preference, identical retry and persisted session.
- Final deployment read-back verified the protected results page and preserved database response.
- Production contains **one explicitly labelled automated verification response**, preferring a card. It is not customer feedback. Real payments and orders are zero.
- No browser screenshot/click QA was requested or performed. Optional WebMCP tools have no verified compatible runtime in this environment; the normal UI and HTTP API are independent of them.

The local storefront preview server was stopped after publication. LaunchLab's existing servers were left alone. Website design files in LaunchLab were not changed for this store.

## Limits and next scope

This is a preference experiment with fictional merchandise. It has no real checkout, inventory, shipping, tester reward transfer, recruitment integration or OKX marketplace registration. It does not prove that LaunchLab can yet take any GitHub repository through managed deployment. The hosted example uses Sites/Cloudflare; LaunchLab's proposed Vercel deployment adapter remains a separate task.

No per-visitor LLM or blockchain call is used. The pilot has a 1,000-session cap, 20 quotes per session and a session-creation rate limit. These are usage safeguards, not a guarantee of free hosting or a provider spending cap.

There is still no LaunchLab issue in the Stardive Linear project. No unrelated JIA issue or portfolio delivery state was changed.
