# Judge walkthrough

LaunchLab turns a supported GitHub repository into a live, instrumented validation pilot, then returns measured results to the founder's agent.

## Entry points

- [Public capabilities website](https://launchlab.stardive.xyz/)
- [Example source: PROOF / REPS](https://github.com/JyTey2004/launchlab-proof-reps-public-demo)
- [Original deployed store](https://preview.d2xy2zo7ya2zs2.amplifyapp.com/): protected founder preview; do not expect anonymous access.
- [Hosted service health](https://launchlab-13-214-10-243.sslip.io/health): public health only; workflow APIs require authorization.

Open the public judge walkthrough linked from the repository homepage. It includes an interactive storefront copy and a redacted read-only snapshot of the actual internal-test report. Collection is disabled in this public copy; the original authenticated deployment retains live collection. No passwords, founder report keys or backend credentials are included.

## Demonstration sequence

1. Inspect the example's GitHub source and exact pinned commit.
2. Inspect LaunchLab's framework evidence, validation goal and target audience.
3. Review the actual tracking hooks and feedback questions proposed by GPT.
4. Inspect the explicit approval and successful AWS build/Amplify delivery.
5. Try selecting gymwear and completing the simulated checkout. No wallet payment or purchase occurs.
6. Inspect the internal-test report. Repeating checkout creates additional actions, while a session is counted once.
7. Inspect feedback and the data-quality explanation. Internal QA must not be interpreted as market demand.
8. Inspect the agent's returned measurements and the current OKX integration evidence.

The original demo's private founder report remains private. Any public snapshot will state its capture time and will not imply that new interactions update that snapshot. Any separate demonstration of browser-only behavior will be explicitly identified.

## What to evaluate

- Can a founder move from a repository to a specific, reviewable experiment?
- Are deployment approval and source-version boundaries explicit?
- Do measured actions and feedback reconcile across agent results and the dashboard?
- Does the product communicate unsupported frameworks and incomplete integration honestly?

See [build-period evidence](build-period.md) and [the provider contract](../okx-provider-interface.md). The service is a controlled free pilot. Automated recruitment, real rewards, real store checkout and deployment billing are not implemented.
