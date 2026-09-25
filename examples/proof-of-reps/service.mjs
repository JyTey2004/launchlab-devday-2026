import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// These are fictional products and prices for a merchant-service experiment.
const catalog = [
  {
    sku: 'proof-tee',
    name: 'Proof of Reps training tee',
    priceCents: 2900,
    activities: ['strength', 'running'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    sku: 'block-shorts',
    name: 'Block Builder training shorts',
    priceCents: 3500,
    activities: ['strength', 'running'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    sku: 'recovery-hoodie',
    name: 'Off-chain recovery hoodie',
    priceCents: 5900,
    activities: ['recovery'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
];
const catalogVersion = 'proof-of-reps-demo-v1';
const shippingCents = 500;
const cohorts = ['automated', 'incentivized', 'organic', 'unknown'];
const key = z.string().trim().min(1).max(100);
const sessionId = z.string().uuid();
export const inputs = {
  open: z.object({ requestKey: key }).strict(),
  recommend: z
    .object({
      sessionId,
      activity: z.enum(['strength', 'running', 'recovery']),
      budgetCents: z.number().int().min(0).max(100000),
      size: z.enum(['S', 'M', 'L', 'XL']),
    })
    .strict(),
  quote: z
    .object({
      sessionId,
      requestKey: key,
      sku: z.enum(['proof-tee', 'block-shorts', 'recovery-hoodie']),
      size: z.enum(['S', 'M', 'L', 'XL']),
      quantity: z.number().int().min(1).max(3).default(1),
      destination: z.literal('SG'),
    })
    .strict(),
  decision: z
    .object({
      sessionId,
      quoteId: z.string().uuid(),
      choice: z.enum(['would_buy_crypto', 'would_buy_card', 'would_not_buy']),
      reason: z.enum(['none', 'price', 'style', 'fit', 'payment', 'delivery', 'other']),
    })
    .strict(),
};
const caveat =
  'Demo only: fictional merchandise, illustrative USD prices, no inventory, order or payment. Shipping is a fixture; taxes are unconfigured. Intent is not a sale.';
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

/** A local tool service. The calling agent supplies the conversation and reasoning. */
export class MerchService {
  constructor(path = ':memory:', { cohort = 'automated', clock = Date.now } = {}) {
    requireThat(cohorts.includes(cohort), 'Unknown acquisition cohort');
    this.cohort = cohort;
    this.clock = clock;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS merch_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)',
    );
    this.db
      .prepare('INSERT OR IGNORE INTO merch_state VALUES (1, ?)')
      .run(JSON.stringify({ sessions: [], quotes: [], decisions: [] }));
  }

  read() {
    return JSON.parse(this.db.prepare('SELECT value FROM merch_state WHERE id=1').get().value);
  }

  change(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read();
      const result = fn(state);
      this.db.prepare('UPDATE merch_state SET value=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  session(state, id) {
    const session = state.sessions.find((entry) => entry.id === id);
    requireThat(session, 'Unknown shopping session');
    return session;
  }

  open(input) {
    const { requestKey } = inputs.open.parse(input);
    return this.change((state) => {
      let session = state.sessions.find((entry) => entry.requestKey === requestKey);
      if (session)
        requireThat(session.cohort === this.cohort, 'Request key belongs to a different cohort');
      else {
        requireThat(
          state.sessions.length < 1000,
          'Local demo limit reached; start a separate experiment database',
        );
        session = {
          id: randomUUID(),
          requestKey,
          cohort: this.cohort,
          openedAt: this.clock(),
          recommendations: 0,
        };
        state.sessions.push(session);
      }
      return {
        sessionId: session.id,
        cohort: session.cohort,
        cohortEvidence:
          'Operator-assigned acquisition label; human identity and acquisition are not verified.',
        catalogVersion,
        products: structuredClone(catalog),
        currency: 'USD',
        destination: 'SG',
        shippingEstimateCents: shippingCents,
        caveat,
      };
    });
  }

  recommend(input) {
    const request = inputs.recommend.parse(input);
    return this.change((state) => {
      this.session(state, request.sessionId).recommendations++;
      const matches = catalog
        .filter(
          (product) =>
            product.activities.includes(request.activity) &&
            product.sizes.includes(request.size) &&
            product.priceCents + shippingCents <= request.budgetCents,
        )
        .map((product) => ({
          ...structuredClone(product),
          estimatedTotalCents: product.priceCents + shippingCents,
          reason: `Listed for ${request.activity}, offered in ${request.size}, within the stated budget before unconfigured taxes.`,
        }));
      return {
        products: matches,
        nextAction: matches.length
          ? 'Ask the shopper which product they prefer before creating a quote.'
          : 'No match. Ask whether the shopper wants to change their budget or activity; do not invent a product.',
        currency: 'USD',
        caveat,
      };
    });
  }

  quote(input) {
    const request = inputs.quote.parse(input);
    return this.change((state) => {
      this.session(state, request.sessionId);
      const previous = state.quotes.find(
        (entry) => entry.sessionId === request.sessionId && entry.requestKey === request.requestKey,
      );
      if (previous) {
        requireThat(
          JSON.stringify(previous.request) === JSON.stringify(request),
          'Quote request key already used for different selections',
        );
        return previous;
      }
      requireThat(
        state.quotes.filter((entry) => entry.sessionId === request.sessionId).length < 20,
        'Shopping session quote limit reached',
      );
      const product = catalog.find((entry) => entry.sku === request.sku);
      requireThat(
        product?.sizes.includes(request.size),
        'Product or size is unavailable in this demo catalog',
      );
      const createdAt = this.clock();
      const subtotalCents = product.priceCents * request.quantity;
      const quote = {
        id: randomUUID(),
        sessionId: request.sessionId,
        requestKey: request.requestKey,
        request,
        catalogVersion,
        product: structuredClone(product),
        size: request.size,
        quantity: request.quantity,
        currency: 'USD',
        subtotalCents,
        shippingEstimateCents: shippingCents,
        taxStatus: 'unconfigured',
        estimatedTotalCents: subtotalCents + shippingCents,
        destination: 'SG',
        createdAt,
        expiresAt: createdAt + 15 * 60 * 1000,
        status: 'demo_quote',
        payableAmount: null,
        paymentRequest: null,
        nextAction:
          'Show the complete estimate and demo caveat. Ask whether the shopper would buy with crypto, would prefer a card, or would not buy. Record only their explicit answer.',
        caveat,
      };
      state.quotes.push(quote);
      return quote;
    });
  }

  decision(input) {
    const request = inputs.decision.parse(input);
    return this.change((state) => {
      this.session(state, request.sessionId);
      const previous = state.decisions.find((entry) => entry.sessionId === request.sessionId);
      if (previous) {
        requireThat(
          JSON.stringify(previous.request) === JSON.stringify(request),
          'This session already has its first decision; a retry must match it',
        );
        return previous;
      }
      const quote = state.quotes.find(
        (entry) => entry.id === request.quoteId && entry.sessionId === request.sessionId,
      );
      requireThat(quote, 'Quote does not belong to this shopping session');
      requireThat(
        this.clock() < quote.expiresAt,
        'Quote expired; obtain a new quote before recording intent',
      );
      const decision = {
        id: randomUUID(),
        sessionId: request.sessionId,
        request,
        recordedAt: this.clock(),
        status: 'demo_intent_recorded',
        evidence: 'Caller-reported preference, not verified shopper behavior.',
        orderCreated: false,
        paymentConfirmed: false,
        caveat,
      };
      state.decisions.push(decision);
      return decision;
    });
  }

  report() {
    const state = this.read();
    return {
      brand: 'Proof of Reps',
      mode: 'demo',
      catalogVersion,
      cohorts: Object.fromEntries(
        cohorts.map((cohort) => {
          const sessions = state.sessions.filter((session) => session.cohort === cohort);
          const ids = new Set(sessions.map((session) => session.id));
          const decisions = state.decisions.filter((decision) => ids.has(decision.sessionId));
          return [
            cohort,
            {
              sessions: sessions.length,
              sessionsWithRecommendations: sessions.filter((session) => session.recommendations > 0)
                .length,
              sessionsWithQuotes: new Set(
                state.quotes
                  .filter((quote) => ids.has(quote.sessionId))
                  .map((quote) => quote.sessionId),
              ).size,
              sessionsWithDecision: decisions.length,
              statedCryptoIntent: decisions.filter(
                (decision) => decision.request.choice === 'would_buy_crypto',
              ).length,
              statedCardPreference: decisions.filter(
                (decision) => decision.request.choice === 'would_buy_card',
              ).length,
              wouldNotBuy: decisions.filter(
                (decision) => decision.request.choice === 'would_not_buy',
              ).length,
              reasons: Object.fromEntries(
                ['none', 'price', 'style', 'fit', 'payment', 'delivery', 'other'].map((reason) => [
                  reason,
                  decisions.filter((decision) => decision.request.reason === reason).length,
                ]),
              ),
            },
          ];
        }),
      ),
      orders: 0,
      confirmedPayments: 0,
      demandValidated: false,
      limitations: [
        caveat,
        'Counts are sessions, not verified unique humans. Agent calls and caller-reported preferences do not prove demand.',
        'Acquisition labels are operator-assigned. Automated and incentivized activity is reported separately from organic-labelled activity.',
        'No storefront views, real wallet interaction, chain receipts, shipping, refunds or tester rewards are implemented here.',
      ],
    };
  }

  close() {
    this.db.close();
  }
}
