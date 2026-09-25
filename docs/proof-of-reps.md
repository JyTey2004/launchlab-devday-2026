# Proof of Reps: a small merchant experiment for LaunchLab

Working concept, 18 September 2026. The name, merchandise and prices are illustrative, not an operating brand or real inventory.

**A gymwear shopping service that lets a customer’s agent find a suitable item, prepare a checkout, and help the founder discover whether people actually want to buy.**

The founder is LaunchLab’s customer. Gymwear shoppers are the founder’s customers. LaunchLab’s commercial product is the deployment and experiment service; it does not become an apparel supplier.

## The smallest useful store

One Singapore-focused drop, three items, four sizes, one settlement network. No NFTs, token launches, loyalty system or secondary marketplace is needed to test the idea.

| Illustrative product          | Product price | Purpose                                          |
| ----------------------------- | ------------- | ------------------------------------------------ |
| Proof of Reps training tee    | US$29         | The accessible first purchase                    |
| Block Builder training shorts | US$35         | An alternative for a practical training use case |
| Off-chain recovery hoodie     | US$59         | Test willingness to pay for a higher-priced item |

The local service uses an explicitly fictional US$5 shipping estimate for Singapore, with taxes unconfigured. It does not calculate a payable crypto amount. Product materials, measurements, inventory and delivery promises must come from a real merchant before launch.

## The agent experience

Shopper: “Find me something for lifting, size M, under US$40 delivered to Singapore.”

1. The calling agent opens the catalog and asks for missing size, budget or activity information.
2. The service filters the catalog. The tee has a US$34 estimate and the shorts US$40 before unconfigured taxes; the hoodie does not fit this budget. The agent explains these options and asks which the shopper prefers.
3. The shopper chooses the tee. The service creates a quote bound to that selection, catalog version and session, with a 15-minute expiry.
4. In the current demo, the shopper sees the limitations and answers: **would buy with crypto**, **would prefer a card**, or **would not buy**. A structured reason identifies price, fit, style, payment or delivery objections.
5. In the future live version, an explicit purchase action opens a wallet checkout. Only a validated payment receipt can mark the order paid. Fulfillment remains a merchant responsibility.

The merchant tools are deterministic; a connected reasoning agent supplies the conversation. The prototype is not an embedded autonomous shopping model. A founder/operator runs the report; it should not become a public shopper-facing tool when the service gains remote access.

## What we learn

The useful distinction is between **demand for gymwear** and **willingness to pay using crypto**. A shopper who wants the tee but asks for a card is different from someone who dislikes the tee at any payment method.

| Question                        | Current demo evidence                                  | Stronger evidence after live checkout                                                                     |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Does the offer interest people? | Sessions requesting recommendations or quotes          | Measured product engagement from recruited users                                                          |
| Is the price acceptable?        | Explicit price objections and stated purchase interest | Purchases at the displayed complete price                                                                 |
| Does crypto add friction?       | Reported preference for crypto or card                 | Checkout attempts, failure reasons and completion, compared under a defined experiment                    |
| Is there traction?              | No validated demand claim                              | Verified purchases from independently acquired customers, with refunds and acquisition cost accounted for |

Current counts are sessions, not verified unique people. Acquisition labels are operator-assigned and unverified. Automated, incentivized, organic-labelled and unknown activity are separate in the report. An agent calling tools does not establish a human shopper.

For an initial usability study, invite five relevant testers. Reward the effort to try the flow and report a blocker or observation, irrespective of purchasing or positive feedback. Keep the tester reward separate from the item price. LaunchLab currently accounts in demo credits, which have no cash value. A later organic demand experiment needs real acquisition and checkout evidence; paid tester completion alone cannot settle that question.

## How LaunchLab fits

The intended founder request is: “Here is my gymwear store repository. Help me deploy the agent service and test whether people want the tee at this price.”

LaunchLab should inspect the pinned repository, ask for missing build and merchant configuration, deploy a preview in the selected LaunchLab demo hosting account, check the critical shopping flow, open a tester mission, and return feedback tied to that release. A price or checkout change creates a new release so the next experiment remains attributable.

Example mission: “Find an item you would consider wearing. Choose your size, inspect the complete estimate, and say whether you would buy it with crypto, prefer a card, or decline. Explain the main reason. No purchase is required.”

**Current integration boundary (updated 18 September):** a standalone storefront and persistent HTTPS merchant service are implemented in `/Users/teyjiaye/Desktop/stardive/proof-of-reps-store` and privately hosted at [Proof of Reps](https://proof-of-reps-launchlab.tey-jia-ye.chatgpt.site). The web flow supports size selection, quotes, preferences and optional written feedback, with an owner-only results page. `examples/proof-of-reps/remote-mcp.mjs` connects the five agent tools to the same web service. This separate example was deployed through Sites; it is not evidence that LaunchLab's planned Vercel adapter, arbitrary-repository deployment or campaign linkage is complete. The service has not been listed on OKX AI, takes no real payment, and has no verified customer acquisition result.

## Why OKX / X Layer

OKX AI could make the merchant capability discoverable to other agents, while X Layer could be the settlement network for the live store. A shopper could ask an existing agent for a recommendation and checkout without the founder building a separate chat product.

OKX’s [A2MCP documentation](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) supports structured services with free calls or paid per-call access, and requires a public HTTPS endpoint for registration. A local stdio MCP server alone does not satisfy that registration. Catalog browsing should start free; charging a shopper’s agent merely to browse an unproven store would add a barrier.

Keep three financial flows distinct:

- **LaunchLab service fee:** what the founder pays for deployment and experiment work; an eventual x402 service call can address this.
- **Merchandise payment:** what a shopper pays for an item, including applicable shipping and taxes. Wallet checkout, payment verification and fulfillment need their own integration.
- **Tester incentive:** what the experiment pays for useful participation; never conditional on a purchase or favourable answer.

The current official A2MCP example configures X Layer mainnet, chain 196, with USDT0. That is not the same network as LaunchLab’s current chain-1952 testnet check. Token support, deployment addresses and a test payment path must be verified during implementation. Do not copy a mainnet token address into a testnet configuration or treat a simulated quote as settled payment.

An ordinary gymwear store does not inherently need a blockchain. The reason to choose this example is to demonstrate agent-mediated commerce and to test whether a crypto-native audience finds that checkout useful. The value of LaunchLab is the reusable repository-to-experiment process, not another bespoke merch store.

## Run the implemented example

From the repository root, with the existing dependencies installed:

```sh
npm run demo:merch
```

This uses the official MCP client and a temporary database. It performs catalog → recommendation → quote → explicit **synthetic** card preference → report. Everything is labelled automated and the database is removed after the demonstration. No participant, purchase, payment or LaunchLab campaign is created.

For an ongoing local session, configure an MCP client:

```json
{
  "mcpServers": {
    "proof-of-reps": {
      "command": "node",
      "args": ["/absolute/path/okx-launch-lab/examples/proof-of-reps/mcp.mjs"],
      "env": { "MERCH_COHORT": "automated" }
    }
  }
}
```

The default database is `.data/proof-of-reps.sqlite`, separate from LaunchLab’s experiment database. Set `MERCH_DB` to use another file. The local operator sets `MERCH_COHORT` to `automated`, `incentivized`, `organic`, or `unknown`; the label is fixed on session creation and is not independently verified. Keep automated clients in the automated cohort. This is a single-operator local prototype, not a public authenticated service.

Tools: `merch_open`, `merch_recommend`, `merch_quote`, `merch_record_intent`, `merch_report`.

Quotes use integer USD cents and reject changed selections under an existing request key. Decisions require a quote belonging to the same session, reject expired new decisions, and record only one initial answer per session. Identical retries do not inflate the report. No tool can record a successful payment.

## Next implementation slice

1. Storefront and HTTPS service adapter implemented as a separate hosted example, with persistent session evidence and authenticated operator reports. Guest access remains private pending the user's sharing choice.
2. Connect this project to LaunchLab's managed deployment adapter and attach its experiment identity to the pinned release and feedback flow.
3. Add merchant-provided inventory, delivery terms and complete pricing, followed by a testnet wallet checkout and independently checked receipts.
4. Invite real testers, then run a separate demand study when an actual merchant can accept and fulfill orders.

The website design agent can use this as the product brief; existing LaunchLab landing-page files have not been changed for this example.
