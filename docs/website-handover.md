# LaunchLab website design handover

Prepared 17 September 2026. The user is delegating website design to another agent; the current agent is continuing the core product. This document is ready to pass to that agent. No separate agent has been started or contacted on the user's behalf.

## Brief

Design the LaunchLab platform website with a dark Web3 aesthetic, purple and pink cyber accents, and a clear explanation of its capabilities. The product helps a builder take a supported repository through a versioned test environment, an incentivized mission, feedback and another iteration. The builder's agent can operate the workflow through MCP. Include **Why OKX** and distinguish capabilities available in the local prototype from planned integrations.

“The Vercel of Web3” is positioning discussed with the user, not a claim of feature parity. The product is a standalone project and does not reuse Stardive components. Working name: LaunchLab.

## Checkout and preview

- Repository: `/Users/teyjiaye/Desktop/stardive/okx-launch-lab`
- Remote: `https://github.com/JyTey2004/okx-launch-lab` (private)
- Local website: `http://127.0.0.1:4310/`
- Existing functional workspace: `http://127.0.0.1:4310/app`
- Isolated project previews: port `4311`
- Start: `npm start`. Node 22.13+ is required. An existing process may already occupy both ports; coordinate a restart rather than starting another on the same ports.
- The checkout has uncommitted website work. Preserve it and the `.data/` directory. Do not reset, clean, delete demo data, or replace the repository.

## File ownership while work proceeds in parallel

Website agent owns `web/index.html`, `web/landing.css`, `web/landing.js`, `web/launch-core.svg` and `web/favicon.svg`. The existing design, copy and brief modal are editable starting points.

Core product agent owns `src/`, `test/`, `scripts/`, package configuration and product/API documentation. The existing workspace files `web/workspace.html`, `web/app.js` and `web/style.css` are functional product UI, outside the landing-page design handover. Coordinate first if broader workspace design is desired.

Static assets are explicitly allowlisted in `src/http.mjs`; coordinate any new asset routes with the core agent. The website CSP allows same-origin scripts and styles. Preserve external JavaScript/CSS files and avoid inline handlers or unapproved remote scripts. A new framework/build system or hosting migration should be coordinated because the existing Node server also runs the product.

## Existing behavior to preserve

- All “Explore demo” links open `/app`.
- The brief dialog validates input, fills a sample, generates an editable planning prompt and copies it. Draft fields persist in tab session storage only.
- Generating or copying a brief does not create a run, purchase work, fund rewards or publish anything.
- Legacy `/#experiment=cmp_…` URLs redirect to `/app#experiment=cmp_…`, including fragment changes while the homepage is already open.
- Keyboard focus, native dialog close, mobile menu, reduced motion and narrow-screen layouts work.
- No invented service ID, OKX listing, checkout or wallet connection.

## Product truth

Currently supported: public GitHub static packages with a root `launchlab.json`, pinned source, isolated local previews with an actual HTTP content check, invitations via local mission links, session reservations, reviewed feedback, capped demo credits, exports and MCP tools. No arbitrary backend execution or contract deployment.

Not yet connected: public authenticated hosting, recruited human testers, live OKX listing/buyer execution, on-chain participant rewards or production settlement. Demo credits have no cash value. An automated example is not a human user or demand validation.

The core agent has implemented a persistent run API so one brief can connect source, preview, campaign and feedback. Refer to `docs/run-api.md` for the tested contract. Keep the planning-only button behavior until deliberately connecting this API. Starting a run requires presenting the returned source and demo-credit allocation, then sending the exact plan digest. Do not auto-start on page load or sample fill.

## References and acceptance

Read `docs/user-journey.md` for the proposed journey and `docs/okx-buyer-ux-research.md` for observed marketplace behavior. Actual inspected listings used a “Use now” → copy prompt → user's own agent flow; no inline checkout/task form was observed. The next integration must verify the real buyer path rather than invent it.

Validate desktop and 320–390px mobile, navigation, dialog generation/edit/copy/validation, keyboard behavior, and runtime console errors. Run `npm run check` and the relevant route test after changes. Full baseline before this handover: 21 tests passing locally; GitHub CI was green for the older committed baseline, not these uncommitted changes.

The website has only been served locally. Public deployment is a separate delivery step. There is no LaunchLab issue in the Stardive Linear project; do not map this work to Stardive's website issue or mark that issue complete.
