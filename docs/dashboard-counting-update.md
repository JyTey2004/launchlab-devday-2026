# Dashboard and action counting — 24 September 2026

The [live founder dashboard](https://preview.d2xy2zo7ya2zs2.amplifyapp.com/__launchlab/results.html)
now follows LaunchLab's charcoal and lavender identity, with its existing logo,
quieter panels and a persistent sidebar. Overview, Activity, Feedback and Data
quality are separate views. Mobile uses compact navigation and retains the Lock
control. Audience and period filters apply across views; stale results disappear
while a changed filter loads. Report keys remain in tab memory and exports contain
the selected report, not credentials.

Reload both the store and dashboard to load the update. Preview credentials and
the founder report key are unchanged.

## Why two checkouts showed one

The previous SDK suppressed repeated event types in a session, and the collector
stored only whether each event happened. The old “Primary actions” metric was
therefore a count of sessions completing the goal. Repeating checkout in one
session still produced one. This was also insufficiently clear in the interface.

The updated report separates:

- **Sessions completing goal:** each opted-in browser session counts once.
- **Recorded goal actions:** every accepted completion, including repeats.
- **Feedback responses:** one saved response per session; resubmission updates it.

Each new action receives a UUID. The SDK keeps that ID on a network retry. The
collector uses optimistic concurrency on the session record, preserving all
distinct receipts while deduplicating retries. A concurrent update rereads and
merges the current record. Feedback lives in separate fields and is preserved.
The collector retains at most 1,000 action receipts per session; requests beyond
the limit fail explicitly. SDK collection requires consent and a registered event
type. No arbitrary event properties or typed inputs are captured.

The checkout hook records successful simulated checkout completion. After a
checkout, the bag is empty and the button is disabled until an item is added.
Clicking a disabled button is not another completed checkout.

## Historical coverage

Earlier records retain their session reach. They cannot reconstruct how often an
action repeated. The report tracks `legacySessions` separately and marks incomplete
action history with a dash or a `+` and “Earlier repeats unavailable.” Its action
count represents recorded newer receipts; older unknown repeats are excluded.
An old browser tab can still submit the older format until reloaded; those writes
are marked as session-only evidence. There is no fabricated backfill.

`eventCounts` retains the existing `sessions` field and adds `occurrences` and
`legacySessions`. The report retains `primaryActions` as goal-session reach for API
compatibility and adds `primaryActionOccurrences`, `primaryActionLegacySessions`,
`measurementVersion`, `windowStart` and `occurrenceCoverage`. Agent analysis inputs
now include action occurrences and their historical coverage as separate evidence.

## Verified on the actual deployment

- The initial live report had one internal QA session/response and one unrewarded
  session, with checkout reach of one in each audience.
- A new Chrome visit marked `test=1` completed checkout twice after consent, adding
  a product before each completion. The resulting delta was **one session, one
  goal-reaching session and two recorded goal actions**. No payment occurred.
- Two concurrent retries of all eight IDs from that same QA session left checkout
  actions at two. Both requests succeeded; no additional session or feedback
  response was created.
- Existing customer/session reach and the prior feedback response were preserved.
- The redesigned UI was reviewed in Chrome at desktop and 390 px mobile width,
  using a loopback read-only proxy for authenticated live report data. Navigation,
  cohort switching, feedback, data quality and mobile locking were checked; the
  page had no horizontal overflow. The direct HTTPS page was also opened to verify
  the deployed design, and all six changed assets matched local file checksums.
- The hosted agent's authenticated report matched the dashboard.
- Final checks: **104 Node tests, 19 Python tests and JavaScript syntax checks**.
  These are local and live-service checks; no new GitHub CI run is claimed.

## Release

Amplify app `d2xy2zo7ya2zs2`, branch `preview`, job `2` succeeded on the existing
URL. The collector received a code-only CloudFormation update; no data table was
replaced. No CodeBuild job or GPT call was needed. The six changed files are the
dashboard HTML/CSS/JavaScript, SDK, legacy widget and shared logo. All customer
application files remained byte-identical in the release archive.

The hosted service also received the updated assets for future deployments and
the expanded analysis evidence format. The deployment retains its original
verification record and a separate `observationReleases` entry for this update.
The prior archive is retained locally on the service and temporarily in the
project's existing private artifact bucket under its lifecycle policy.

[Sanitized release evidence](../deploy/dashboard-counting-evidence.json)

No OKX AI publication or payment integration was performed. No matching LaunchLab
Linear issue was found during the required workspace bootstrap; no canonical
Stardive issue state was changed.
