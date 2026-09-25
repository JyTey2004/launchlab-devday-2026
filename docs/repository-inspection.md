# Step 1: GitHub repository → framework and deployment recipe

Implemented locally on 19 September 2026. This is real GitHub inspection, not the simulated inspection in the separately hosted founder-interface mock. It does not execute repository code or create a deployment. Website design remains a separate workstream.

## Try it

From the `okx-launch-lab` checkout:

```sh
npm run inspect:repo -- https://github.com/vercel/nextjs-postgres-auth-starter
```

Append `--json` for the complete structured result. Public repositories need no GitHub credential, subject to GitHub rate limits. For private repositories, the local operator may configure `LAUNCHLAB_GITHUB_TOKEN` privately in the process environment or `.env`; no credential argument or request field is accepted. Browser GitHub App authorization, wallet binding and zkTLS are later steps.

For a monorepo, the inspector returns a folder-selection question. Inspect the chosen folder at the _returned commit_ so the source cannot silently move between questions:

```sh
npm run inspect:repo -- https://github.com/OWNER/REPO --root apps/web --ref FULL_RETURNED_COMMIT_SHA
```

The inspector also remains available through:

- HTTP: `POST /api/deployments/inspect`, using the existing local origin/API-token authorization.
- MCP: `launchlab_inspect_deployment`, with the same input and result. Start the core API before using its MCP server.

```json
{
  "repoUrl": "https://github.com/vercel/nextjs-postgres-auth-starter",
  "ref": "HEAD"
}
```

## What the calling agent receives

1. Canonical repository URL and resolved commit SHA.
2. Framework candidate, frontend libraries, selected folder, package manager, lockfile evidence and a declared Node version range when available.
3. Evidence paths and bounded descriptions. Script bodies, arbitrary package metadata and environment values are omitted.
4. An advisory `deploymentPlan` with a hosting candidate, install/build command candidates, their working directories and expected output handling.
5. Focused questions about folder selection, package-manager conflicts, custom configuration, runtime dependencies and environment names.

The plan always has `kind: "advisory"`, `canDeploy: false`, and `adapter.implemented: false`. It is neither a worker execution contract nor deployment authorization. The Next.js recipe leaves output handling to the provider; it does not propose publishing `.next` as a static directory. A basic Vite frontend gets the unverified default `dist`; custom config and server/runtime signals require review.

| Case                                                                | Result                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Next.js                                                             | Candidate Vercel framework deployment                                                         |
| Ordinary Vite frontend                                              | Candidate build-and-serve-static-assets deployment                                            |
| Plain HTML without a package manifest                               | Candidate static-assets deployment, no package install                                        |
| Vinext, SvelteKit, Nuxt, Astro, React Router, Remix, TanStack Start | Recognized framework; deployment adapter requires review                                      |
| Unknown or conflicting frameworks                                   | Ask for runtime/framework information                                                         |
| Parent/workspace lockfile                                           | Identify it but ask about workspace layout before proposing executable install/build commands |
| GitHub 401/403/404                                                  | `needs_access`; no claim that the repository is missing or that the requester owns it         |

Detection is deliberately bounded: at most 5,000 tree entries, selected config files up to 100 KB, and at most 100 template environment names. An explicit app root bypasses the 20-package root-selection limit, but not the tree-size limit. Framework/hosting configs are identified by filename, not evaluated. Required environment variables not documented in `.env.example` or `.env.sample` may be missed. Package versions, routing, migrations, native dependencies and provider compatibility still need build/runtime verification.

Only the folder-selection question can currently be answered directly by repeating this endpoint with `rootDirectory`. Other configuration answers must become part of the next immutable, authorized deployment-plan step; do not pretend they have already been applied.

## Live inspection evidence

The command above successfully read the public Vercel starter on 19 September 2026, resolving commit `fde8ecf1da9337223081f70cf88b420060039d6e`.

- Framework: Next.js with React.
- Package manager: pnpm, evidenced by `pnpm-lock.yaml`.
- Candidate install/build: `pnpm install --frozen-lockfile`, then `pnpm run build`, at repository root.
- Hosting candidate: Vercel, framework-managed output.
- External-service signals: Drizzle and Postgres.
- Template names: `AUTH_SECRET`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`.
- Result: `needs_input`, with environment and external-service questions.
- No build, deployment, secret submission, payment, repository mutation or ownership verification occurred.

This read-only example establishes inspector behavior, not authorization to deploy someone else's project. Its public metadata may change; use the recorded SHA to repeat the same inspection.

Verification: all 52 local tests passed, including HTTP and official MCP-client inspection, existing launch flows, unsupported-runtime cases, workspace ambiguity and secret-value omission. JavaScript syntax checks and `git diff --check` passed. The full test suite required loopback-listening permission because the sandbox initially blocked its local HTTP servers. These results cover the local working tree, not a new hosted CI run.

## Next implementation step

Resolve the returned questions into a pinned deployment plan, connect the chosen LaunchLab hosting account, and implement one managed provider adapter. Its isolated build must return a real deployment ID and HTTPS URL, with failure/status reconciliation and a readiness check. Keep the existing manifest-based local preview/run flow separate until that integration exists.

The founder mock and OKX listing are not connected to this backend yet. They can consume this same HTTP/MCP contract when those adapters are implemented. No new Linear delivery status was recorded: the live Stardive project has no matching LaunchLab issue/spec; unrelated Stardive issues were left unchanged.

## Sources for recipe defaults

- [Vercel Next.js deployment](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vite static deployment and default output](https://vite.dev/guide/static-deploy.html)
- [Vite on Vercel, including separate SSR considerations](https://vercel.com/docs/frameworks/frontend/vite)
