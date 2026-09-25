# Hosted workflow service

Live demo origin: **https://launchlab-13-214-10-243.sslip.io**.
[Health check](https://launchlab-13-214-10-243.sslip.io/health) ·
[Recorded verification](../deploy/hosted-service-evidence.json).

The [provider interface](okx-provider-interface.md) adds a guided JSON contract
and remote HTTP MCP at `/api/okx/mcp`, using the same authenticated callers and
worker queue. It exposes questions, approval, progress and results for a future
OKX A2A provider runtime. It does not register a marketplace service or connect
workflow payments.

This is the invite-only hosting/reliability stage before OKX AI publication. The
local operator dashboard remains separate. Public GitHub repositories containing
supported static HTML/Vite apps are accepted; private GitHub authorization is not
implemented on the hosted service.

On 24 September 2026, the sanitized public copy
[`JyTey2004/launchlab-proof-reps-public-demo`](https://github.com/JyTey2004/launchlab-proof-reps-public-demo)
completed a real GPT plan, AWS build, Amplify deployment, browser interaction,
feedback collection and external-agent report/analysis. The original
`JyTey2004/launchlab-proof-reps-demo` remains private; private-repository intake
still needs a scoped GitHub connection. See the [demo walkthrough](hosted-proof-reps-demo.md)
and [live evidence](../deploy/hosted-proof-reps-evidence.json). The earlier MDN
intake/restart smoke test remains recorded separately.

## Caller journey

1. An operator provisions a caller and delivers its service key privately.
2. `POST /api/agent/workflows` accepts the repo URL and a unique `requestKey`.
   It returns HTTP 202 with a durable `job_*` ID and `workflowId`.
3. Poll `GET /api/agent/jobs/:id`. A completed job contains the workflow's
   questions or reviewable plan. `GET /api/agent/workflows/:id` also returns its
   latest job. Queued means accepted, not a completed deployment.
4. Answer through `POST /:id/answers`. Explicitly authorize the current revision
   and plan digest through `POST /:id/start`; only then may AWS resources/builds
   be created. These operations also return durable jobs.
5. Read verified delivery, access credentials, cohort-filtered reports, or request
   evidence analysis. Status/report reads never invoke GPT. Analysis requires an
   `Idempotency-Key` header; reuse it only for retries of that exact request.

All `/api` requests require `Authorization: Bearer <service-key>`, including
status and preview credentials. Ownership is checked before any workflow access.
The only anonymous route is `GET /health`; it returns 503 when worker heartbeat is
stale. There is no public account registration or cloud settings route.

For an external MCP client, run `node scripts/hosted-mcp.mjs /private/path/client.json`.
The wrapper reads its HTTPS origin and bearer key from the private file and exposes
only the nine supported workflow/job tools. Alternatively, use `src/mcp.mjs` with
`LAUNCHLAB_URL`, `LAUNCHLAB_API_TOKEN` and `LAUNCHLAB_HOSTED=true` set privately.
`launchlab_get_job` polls accepted jobs. Supply `requestKey` to
`launchlab_analyze_workflow` on this host.

## Persistence and recovery

SQLite WAL with `synchronous=FULL` stores hashed API keys, ownership, jobs,
idempotency receipts and quota reservations. Tenant-specific directories contain
workflow/experiment/deployment evidence. Namespaced request keys also create
different AWS resource identities for different callers using the same input key.

One OS-flock-protected worker executes jobs. systemd restarts failed processes;
accepted queued jobs survive restarts. Interrupted jobs reconcile persisted
workflow state and approved deployment IDs. Completed saved plans are reused.
Uncertain model calls/analysis return `needs_recovery`; they are never blindly
rebilled on restart. Review the workflow and explicitly resume before another
planning attempt. Unknown or live operation-lock owners fail closed.

Deployment recovery reuses its CloudFormation stack, CodeBuild run and Amplify
job. An interrupted upload or ambiguous upstream state can require operator
inspection; recovery does not guarantee every upstream operation can auto-resume.

## Infrastructure and limits

- Dedicated Singapore VPC, one `t4g.small` instance, encrypted 20 GB gp3 disk,
  persistent IP, Caddy HTTPS. Only TCP 80/443 are public; administration uses SSM.
- The root disk is retained on instance termination. This is one host, not a
  multi-region or highly available platform.
- The API listens on loopback and exposes only workflow/job and provider routes. It does not
  load the OpenAI secret; the worker obtains that single secret through its
  instance role. No local AWS access key, personal GitHub token or OKX wallet key
  is included in the release.
- Customer builds still run in dedicated CodeBuild workers. Generated build and
  collector roles have a permissions boundary and resource-scoped inline policy.
  Hosted deployment stacks use the `llh-` prefix and a dedicated provisioning role.
- Three hosted deployment reservations globally; five active jobs and twenty
  workflows per caller; six model calls per caller and ten globally per UTC day.
  Failed or uncertain calls consume the allowance. Reservations are retained until
  the operator verifies an environment is removed. Local historical deployments
  are outside this new service's quota.
- 120 authenticated requests per caller per minute and 1,000 total API requests
  per minute; 16 KB request bodies. This is basic admission control, not a DDoS SLA.
- Builds remain bounded to ten minutes and one build run. There is no automatic
  hosting expiry, spending ceiling in dollars, tester recruitment or payouts.

AWS Pricing API on 2026-09-22 quoted US$0.0212/hour for this Singapore instance
(about $15.48 at 730 hours). Allow roughly $20–25/month for the base service with
IPv4, disk and one secret; S3, traffic, project environments, builds and GPT usage
are additional. Credits/taxes are not included. Stop the instance to stop compute
charges; retained disks/IP and deployed project environments continue billing.

## Operator commands

From the application directory on the host, with `LAUNCHLAB_HOSTED_DATA` set:

```sh
node scripts/hosted-client.mjs create founder /private/path/client.json
node scripts/hosted-client.mjs rotate tenant_ID /private/path/new-client.json
node scripts/hosted-client.mjs revoke key_ID
```

Creation/rotation writes a new mode-0600 file; it never prints the token. Rotation
issues another key; explicitly revoke the old key after handing over the new one.
Keep credential files out of Git and shared logs.

From the operator's local checkout, `node scripts/hosted-invite.mjs founder
.data/hosted-operator/new-client.json` provisions a remote caller. Its bearer is
generated locally; only the hash crosses SSM. Confirm the returned SSM command
succeeded before using the credential. The initial founder demo credential is
`.data/hosted-operator/founder-client.json` (ignored by Git).

`deploy/hosted-template.mjs` defines infrastructure. After its stack is ready,
`node scripts/hosted-release.mjs` uploads an allowlisted release, updates only the
OpenAI runtime secret, verifies archive hashes and installs using SSM. The
release excludes `.env`, `.data`, `.git` and browser/user credentials. Previous
versioned release directories remain available for a controlled rollback.

Backups are currently operator-triggered. Stop `launchlab-worker`, run
`scripts/hosted-backup.py` with the service environment, then restart the worker.
The script takes the OS worker lock, uses SQLite's backup API and archives tenant
evidence into the private encrypted release bucket. Restore into an empty data
directory with both services stopped; restore ownership to `launchlab`, start the
worker/API and check health. A restore may recover interrupted jobs, and must not
be run alongside the original live worker. Automated backup scheduling and a
tested disk-loss restoration are follow-up work.

## Scope of verification

See `deploy/hosted-service-evidence.json` for actual cloud smoke-test evidence
when available. Local tests cover key hashing/revocation, idempotency conflicts,
ownership on reads/writes, quotas, queue reopen/recovery, uncertain-model handling,
approved-deployment reconciliation, public route isolation and archive boundaries.
The existing workflow suite exercises the complete repo-to-report MCP journey
with deterministic model/build fixtures. The separate
[PROOF / REPS evidence](../deploy/hosted-proof-reps-evidence.json) records the
actual hosted GPT/build/browser run, including failed attempts and operator fixes.
It contains one internal QA response and zero organic customer responses, not
market validation. Final verification passed 103 Node tests, 16 Python tests,
syntax checks, desktop/mobile browser checks and external MCP report/analysis.
