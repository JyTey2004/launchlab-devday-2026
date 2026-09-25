# OKX AI / X Layer integration

Verified against official documentation on 17 September 2026.

**25 September registration update:** LaunchLab provider identity **13905** was
created with the confirmed free **Launch and Validation Pilot** A2A service.
The official communication check passed on the local Mac using Codex and
`okx-a2a` 0.2.16. The user subsequently authorized listing submission, and OKX
accepted it for review; the response did not report publication. Marketplace
buyer/task binding, live delivery and deployment payment integration remain pending.
[Registration evidence](../deploy/okx-registration-evidence.json) ·
[Listing submission evidence](../deploy/okx-listing-evidence.json).

**24 September update:** the hosted [provider interface](okx-provider-interface.md)
now exposes the full workflow through authenticated JSON and remote HTTP MCP.
It is a backend for a future OKX A2A provider runtime; marketplace registration,
task communication and deployment payment integration remain pending. The
readiness-report payment implementation below remains a separate capability.

The initial sellable capability is a bounded **static-package readiness report**. The full deployment-and-feedback workflow is longer lived and should use a job model; it must not claim that a job ID alone completes a paid deployment or testing service.

## Current code

`npm run seller` starts a separate Express API on `127.0.0.1:4312` in free mode. `POST /v1/readiness` takes `{repoUrl?, ref?}` and returns a structured report. The dashboard API is not the public seller interface.

The [OKX A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) supports free structured-result endpoints and paid x402 endpoints. Registration needs a reachable HTTPS service and platform review. The local stdio MCP server is useful for building, but is not itself an OKX listing.

## Optional x402 testnet mode

Copy `.env.example` to `.env` and fill these values locally:

```dotenv
SELLER_MODE=x402
PAYMENT_NETWORK=eip155:1952
PAY_TO_ADDRESS=your-actual-40-hex-character-receiving-address
OKX_API_KEY=your-developer-key
OKX_SECRET_KEY=your-secret
OKX_PASSPHRASE=your-passphrase
READINESS_PRICE=$0.01
```

Run `npm run seller`. The exact-scheme middleware comes from the official `@okxweb3/x402-express`, `@okxweb3/x402-core` and `@okxweb3/x402-evm` packages. A paid-mode configuration must initialize successfully; missing credentials fail startup and never silently become a free service. Testnet is the default. Mainnet additionally requires `ALLOW_MAINNET=true`; it has not been exercised.

The [OKX seller SDK guide](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk) describes challenge, payment replay and facilitator verification. Our offline tests use the actual SDK with a mock facilitator to verify the v2 `PAYMENT-REQUIRED` header, reject invalid proof, deliver a report after simulated settlement, withhold it after failed settlement, and avoid settlement when inspection fails. Separately, on 22 September 2026, an approved **0.01 test USD₮0** call to LaunchLab's local endpoint returned the built-in example's readiness report. The wallet reported success, and the public testnet RPC confirmed a successful receipt and the exact token transfer. Buyer and recipient were the same wallet, so this establishes payment integration rather than a sale between accounts. [Live payment evidence](../deploy/launchlab-seller-testnet-payment-evidence.json). See the [local testing and faucet runbook](local-testing-and-xlayer.md) for repeatable checks and the official testnet resources.

The live SDK settlement response contained both `success: true` and `status: timeout`. We confirmed finality independently using the transaction receipt; do not treat that mixed response as sufficient settlement evidence. Public-service acceptance still needs reconciliation for pending/timeout responses, duplicate-payment tests and separate buyer/merchant accounts.

This payment buys the inspection service. It does not fund or settle a campaign reward pool. There is no connection between the non-monetary local ledger and x402 payments in this version.

On 21 September 2026, an approved 0.01 USDC_TEST payment attempt against OKX's official Mock Merchant reached an external blocker: its verification backend returned HTTP 401. The normal CLI transport first returned HTTP 402 without a receipt; a documented legacy transport reached the failing verifier. Refreshed wallet balances remained unchanged and no outgoing transaction was observed. LaunchLab's own seller subsequently passed the separate test described above; the mock-merchant failure remains unresolved. [Diagnostic evidence](../deploy/x402-testnet-smoke-evidence.json).

## X Layer

- Testnet chain ID: **1952**, CAIP-2 `eip155:1952`.
- RPC: `https://testrpc.xlayer.tech/terigon`.
- Gas asset: test OKB.
- Mainnet chain ID: 196; not enabled by default.

Source: [X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information). The prototype's RPC check is read-only. Chain configuration is not contract-deployment evidence. The static preview intentionally blocks wallet interactions pending a dedicated adapter.

## Hackathon release checklist

1. Deploy only the bounded seller API over HTTPS, with monitoring and request limits; add account isolation before exposing the operator dashboard.
2. Run the free endpoint from an external client; verify the report is correct for a public supported repository at a pinned commit.
3. Repeat the successful local testnet payment through the public HTTPS endpoint with separate buyer/merchant accounts; retain the chain receipt and verify timeout/replay handling.
4. Register on OKX AI using the actual endpoint and response schema; revise the draft listing to the accepted platform fields.
5. Capture the listing/integration URL and an end-to-end video showing the product's real scope.
6. For the full incentive story, demonstrate a recruited human and a real reward path; label any remaining simulation.

The [Build a Company brief](https://www.okx.com/en-sg/learn/okx-dev-day-builder-kit) calls for a working service or integration, an end-to-end workflow and a usable URL. This repository prepares that work; it is not a submitted hackathon entry.
