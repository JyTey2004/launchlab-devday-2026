# Local testing, then X Layer testnet

## Scope

The local stage verifies LaunchLab's repository inspection, reviewed tracking edits,
preview workflow, consent, feedback collection and reporting. External GitHub,
OpenAI, AWS and payment settlement boundaries use fixtures in the automated suite.
These tests do not deploy another cloud environment, call GPT or transfer tokens.

The bounded `POST /v1/readiness` payment adapter is a separate service from the
long-running deployment workflow. A successful readiness payment does not buy or
complete an AWS deployment, a recruitment campaign or a tester payout.

## Repeat the local checks

From the repository root, with Node 22.13+ and Python 3 available:

```sh
npm test
npm run check
python3 -B -m unittest discover -s test/managed -p 'test_*.py'

# Payment boundary only: real OKX SDK, mock facilitator, no wallet or funds.
node --test test/seller.test.mjs

# Disposable browser fixture; open the printed URL, including ?test=1.
python3 -B test/managed/widget-smoke.py
```

The browser fixture uses the actual tracking SDK, feedback widget and Python
collector with an in-memory store. It accepts only test actors. Stopping its process
discards that test data. It does not touch the running founder dashboard or the
existing Amplify experiment.

1. Try the example product action before consenting: it must not be tracked.
2. Allow tracking, then click **Add example tee to bag**.
3. Open **Share feedback**, complete the form, and submit a clearly labelled QA response.
4. Inspect `/__test/report`: the test cohort should contain one session, one product
   action and one feedback response; the organic cohort should remain empty.
5. Re-submit feedback to verify it updates the existing response rather than adding
   a second participant. Consent withdrawal is also covered by automated tests.

Automated payment checks cover:

- Free inspection and an unpaid request returning the SDK's payment challenge.
- Invalid proof never reaching the inspection handler or settlement.
- Successful simulated settlement returning the report and a payment receipt.
- Failed simulated settlement withholding the computed report.
- Failed inspection returning a bounded error without attempting settlement.
- Invalid input being rejected before a payment challenge.
- Missing paid-mode credentials and mainnet configuration without opt-in failing closed.

The mock facilitator does not verify a cryptographic signature or execute on-chain.
Its receipt deliberately contains no transaction hash. Live duplicate-payment,
wallet-signature and on-chain settlement behavior require separate testnet evidence.
The live check below covers one successful self-payment; duplicate/replay behavior
and commerce between separate accounts remain unverified.

## Official faucet and live payment sequence

Official resources checked on 20 September 2026:

- [X Layer faucet](https://web3.okx.com/xlayer/faucet/xlayerfaucet)
- [OKX buyer testnet guide](https://web3.okx.com/onchainos/dev-docs/payments/payment-use-buyer)
- [OKX seller SDK guide](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk)

The faucet's live UI offered **0.2 test OKB**, **10 test USDT** and **10 test USDC**
per request, as well as a USDG choice. A slider CAPTCHA appeared for token requests.
Reaching that prompt is not evidence that tokens were issued.

The buyer guide's example uses **test USD₮0**, but the live official Mock Merchant
quoted **0.01 USDC_TEST** on chain **1952** during this check. Its two options were
`exact` and `aggr_deferred`; both quoted the same asset. The CLI reported the balance
as **unavailable**, which is not proof of a zero or sufficient balance. After the
user completed both faucet CAPTCHAs, a separate `wallet balance --chain 1952` read
confirmed **10 USD₮0 and 10 USDC_TEST**. The USDC contract matched the merchant's
live challenge. The quote checker continued to report the balance as unavailable.
Check the current challenge's token contract against the received asset before
paying. A matching ticker alone is insufficient.

1. Use the current Onchain OS wallet's address for **X Layer Testnet, chain 1952**.
   Resolve it freshly with `onchainos wallet addresses --chain 1952`.
2. Complete the official faucet request and confirm the received test-token balance.
   The buyer guide also links the faucet for test OKB; gas requirements can depend
   on the payment path and sponsorship.
3. Quote the official Mock Merchant using the installed OKX payment skill:
   `onchainos payment quote https://www.okx.com/api/v1/pay/mock-merchant/resource`.
4. Check the live quote's network, exact asset, recipient and amount. The live quote
   during this check was 0.01 USDC_TEST; the current quote always controls the request.
   Confirm those terms before signing. Stop if the challenge offers mainnet.
5. Retrieve the delivered resource and receipt, then verify the actual transaction
   on the testnet explorer. A quote or signature alone does not prove settlement.
6. Configure LaunchLab's own seller for `eip155:1952`, with a verified receiving
   address and authenticated facilitator; repeat against its readiness endpoint.
   Use a separate payee if the payment path requires one.

The API credentials' presence in `.env` is not proof of facilitator access. Do not
overwrite `.env` or copy it into frontend code or evidence. Do not enable mainnet.

## Local evidence recorded on 20 September 2026

- Final run: **79 Node tests**, **10 Python tests** and JavaScript syntax checks passed.
- Four payment boundary tests were added; all seven seller tests passed.
- Browser QA saved one test session, one `add_to_bag` action and one response;
  the organic cohort contained zero sessions and zero responses.
- The browser displayed **Saved. Thank you.** The collector report was additionally
  checked via HTTP because direct browser navigation to its JSON route was blocked.
- The official test merchant's live quote was read; no payment had been signed
  during this local-testing stage. See the subsequent approved attempt below.
- Testnet funding was verified independently before requesting approval for the
  first 0.01 USDC_TEST payment.
- No new GPT request, AWS deployment or real payment was made by these local checks.

These are local working-tree results. The existing green GitHub run applies to the
older committed revision, not these uncommitted additions. No corresponding LaunchLab
issue/spec was found in the Stardive Linear project or portfolio; no delivery state
was changed there.

## Approved payment attempt on 21 September 2026 (Singapore)

The user approved one 0.01 USDC_TEST payment to the official Mock Merchant on
X Layer Testnet. The saved quote had expired before use, so a fresh quote was
checked against the exact approved network, asset contract, amount, recipient
and one-time method before executing. The expired quote did not execute payment.

The current CLI's normal quote/payment flow returned HTTP 402 again, with
`status: pending` and no transaction hash. That is not settlement evidence.
Unsigned diagnostic requests established that the merchant ignored
`PAYMENT-SIGNATURE`, but parsed `X-PAYMENT`. Its public challenge also mixed a
v2 version marker with legacy body fields and omitted the v2 challenge header.

A compatibility retry used the CLI's raw signed proof in the documented legacy
`X-PAYMENT` envelope. No signed fields were altered, logged or saved. This reached
the merchant's verification backend, which returned HTTP 500 with an internal
HTTP **401** from `/api/v6/pay/x402/verify`. The sample endpoint therefore did not
deliver the resource or a successful receipt. Further payment retries were stopped.

The final refreshed wallet check still showed **10 USDC_TEST and 10 USD₮0**. Its
recent history contained only the two incoming faucet transactions. No debit or
outgoing payment was observed. This is an external verification blocker, not a
passed on-chain payment test. LaunchLab's own seller has not yet been paid on testnet.

[Sanitized diagnostic evidence](../deploy/x402-testnet-smoke-evidence.json).

As an independent check, LaunchLab's configured official SDK client successfully
retrieved supported payment methods, including `exact`, `aggr_deferred` and `upto`
on testnet 1952. No credential values were displayed. This read-only response does
not prove that the credentials can verify or settle a payment.

The next payment test should exercise LaunchLab's own seller and current SDK
transport. A payment to another seller requires its actual recipient and terms
to be reviewed; this approval was specific to the official Mock Merchant.

## LaunchLab seller preflight on 21 September 2026

A separate loopback seller runs at `http://127.0.0.1:4312/v1/readiness` using the
real OKX SDK and the configured API credentials. The operator dashboard is unchanged.
For the first paid check, the existing test wallet is both buyer and recipient;
this can verify payment handling but cannot demonstrate commerce between accounts.
No receiving address or payment mode was written into `.env`.

Verified before requesting payment approval:

- An unpaid request returns HTTP 402 with a proper v2 `PAYMENT-REQUIRED` header.
- The quote requests 0.01 **test USD₮0** on chain 1952, using the SDK's default
  asset. This differs from the mock merchant's USDC_TEST quote.
- Malformed input returns HTTP 400 before payment handling.
- A deliberately invalid, zero-filled signature reaches the real facilitator,
  which returns `invalid_signature`; no settlement is attempted.
- The payment CLI originally sent an empty POST body and received HTTP 400. The
  endpoint now treats an omitted body as the built-in example. Supplied bodies
  still undergo strict schema validation. A regression test covers free and paid modes.
- The CLI now quotes that bodyless request successfully. Its balance checker still
  reports unavailable; a separate wallet query verifies the token balances.
- All **80 Node tests** and JavaScript syntax checks pass locally after the fix.

The next call buys only the built-in example's static-readiness report. It creates
no deployment, GPT request, campaign or tester payout. A valid signed payment and
on-chain receipt were pending approval at this preflight stage; see the completed
test below.

[Seller preflight evidence](../deploy/launchlab-seller-testnet-preflight.json).

## Approved LaunchLab payment on 22 September 2026

After explicit approval, the expired quote was refreshed and checked against the
approved terms: one 0.01 test USD₮0 payment on chain 1952 to the existing test wallet.
Exactly one paid request was submitted to the local readiness endpoint. The real
facilitator accepted the signature, and the CLI returned `status: success` plus
the **Hello X Layer** static-readiness report (`packageReady: true`, `deployed: false`).

Transaction: `0x9e8407fbacb38a3ba79858b7fa6830cff6e159c2f1238371fed60fe4aad0c615`.

Independent verification through the public testnet RPC established:

- Chain ID 1952 and a successful receipt (`status: 0x1`).
- Block 41599432, with 78 confirmations when checked.
- A transfer of exactly 10000 atomic units (0.01 USD₮0) from the approved wallet
  to itself, emitted by the quoted token contract.
- The wallet history separately reported `SUCCESS`. USD₮0 remained at 10, as
  expected for a self-transfer; USDC_TEST remained at 10.

The SDK's settlement result contained `success: true` with `status: timeout`.
The chain receipt resolves this attempt as successful, but a future public service
must reconcile pending/timeout responses rather than rely on either field alone.
No additional payment was signed to investigate this result.

This verifies a real testnet payment and paid report delivery through the local
LaunchLab seller. It does not establish revenue, a sale between accounts, public
HTTPS availability, an OKX AI listing, deployment billing, campaign funding or
tester payouts. Duplicate/replay behavior also remains untested on testnet.

Only sanitized payment terms, report fields and public transaction evidence were
saved. Credentials and wallet signatures were not written to the evidence file.
The earlier 80 passing Node tests and syntax checks apply to the tested working
tree; this documentation update did not change runtime code or create a new CI run.

[Verified payment evidence](../deploy/launchlab-seller-testnet-payment-evidence.json).
