# LaunchLab judge playground

An interactive founder walkthrough using the public **Dev Day Pulse** example. Browser demo first, optional official OKX purchase prompt alongside it.

## Try it

1. Choose **Start the 2-minute demo**.
2. Review the example plan and choose **Yes, open the sample**.
3. In the sample, optionally allow local recording, create a brief and give feedback.
4. Choose **See my evidence**. The counts come from this iframe visit, not seeded examples.

No wallet, login, API key or model call is needed. This static rehearsal opens an already-built app; it does not buy an OKX task, build a new preview or collect shared attendee results. Feedback and sample activity stay in the browser. Reloading creates a new visit with recording off; earlier browser data does not enter the walkthrough's summary. **Clear local data** in the sample is the explicit deletion control.

Use [prompt.txt](prompt.txt) for the optional real service. The agent must use official OKX buyer discovery to confirm the current offer, then ask for selection and exact purchase confirmation. Additional model, build, deployment and hosting costs require their own approval. No live fee, availability or automatic acceptance is asserted by this page.

## Public example source

- Repository: https://github.com/JyTey2004/launchlab-devday-pulse
- Pinned source: `76fa3ae06b8ea8a6a7fd1e58fa82723687296c72`
- Vite sample; Node 22.12+; no required secrets or backend.
- Local observations do not establish unique people, customer traction or purchases. Brief generation uses fixed templates.

The bundled sample includes a disposable-copy adapter and separate browser storage namespace. Only sanitized current-visit counts go to the actual same-origin parent. Form answers, price values, comments, timestamps and session identifiers are not relayed. [sample-manifest.json](sample/sample-manifest.json) records exact source, build and file hashes.

## Preview the judge page locally

From the submission repository:

```sh
python3 -m http.server 4458 --bind 127.0.0.1 --directory judge-site
```

Open http://127.0.0.1:4458/try/. Only the reviewed static judge-site directory is served.

To rebuild the sample, use a separate clean clone at the pinned source, install its declared dependencies, and run:

```sh
node scripts/build-judge-sample.mjs /absolute/path/to/clean/launchlab-devday-pulse
node --test test/judge-sample.test.mjs test/judge-playground.test.mjs
```

The helper verifies the exact commit and installed Vite version, then modifies a disposable copy. It does not install packages or access the network. The existing Pages workflow publishes `judge-site/` when a reviewed commit is pushed to main. Publishing this static kit does not publish local LaunchLab backend changes.
