import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MerchService } from '../examples/proof-of-reps/service.mjs';

function quoteInput(sessionId, requestKey = 'quote-1') {
  return { sessionId, requestKey, sku: 'proof-tee', size: 'M', quantity: 1, destination: 'SG' };
}

test('merch recommendations include shipping in the budget and never invent an unavailable match', (t) => {
  const service = new MerchService();
  t.after(() => service.close());
  const session = service.open({ requestKey: 'shopper' });
  assert.equal(service.open({ requestKey: 'shopper' }).sessionId, session.sessionId);
  const preference = {
    sessionId: session.sessionId,
    activity: 'strength',
    budgetCents: 3500,
    size: 'M',
  };
  assert.deepEqual(
    service.recommend(preference).products.map((product) => product.sku),
    ['proof-tee'],
  );
  assert.deepEqual(service.recommend({ ...preference, budgetCents: 2900 }).products, []);
  assert.deepEqual(service.recommend({ ...preference, activity: 'recovery' }).products, []);
  assert.equal(service.report().cohorts.automated.sessionsWithRecommendations, 1);
});

test('merch estimates use catalog prices, reject invalid selections and preserve identical retries', (t) => {
  const service = new MerchService();
  t.after(() => service.close());
  const { sessionId } = service.open({ requestKey: 'shopper' });
  const input = { ...quoteInput(sessionId), quantity: 2 };
  const quote = service.quote(input);
  assert.equal(quote.estimatedTotalCents, 6300);
  assert.equal(quote.taxStatus, 'unconfigured');
  assert.equal(quote.payableAmount, null);
  assert.equal(quote.paymentRequest, null);
  assert.deepEqual(service.quote(input), quote);
  assert.throws(() => service.quote({ ...input, quantity: 3 }), /different selections/);
  assert.throws(() => service.quote({ ...input, priceCents: 1 }));
  assert.throws(() => service.quote({ ...input, quantity: -1 }));
  assert.throws(() => service.quote({ ...input, size: 'XXL' }));
  assert.throws(() => service.quote({ ...input, destination: 'US' }));
  assert.equal(service.report().cohorts.automated.sessionsWithQuotes, 1);
});

test('merch decisions require an owned, unexpired quote; retries do not create additional intent', (t) => {
  let clock = 1000;
  const service = new MerchService(':memory:', { clock: () => clock });
  t.after(() => service.close());
  const first = service.open({ requestKey: 'first' });
  const second = service.open({ requestKey: 'second' });
  const quote = service.quote(quoteInput(first.sessionId));
  const decision = {
    sessionId: first.sessionId,
    quoteId: quote.id,
    choice: 'would_buy_crypto',
    reason: 'none',
  };
  assert.throws(
    () => service.decision({ ...decision, sessionId: second.sessionId }),
    /does not belong/,
  );
  clock = quote.expiresAt;
  assert.throws(() => service.decision(decision), /expired/);
  const fresh = service.quote(quoteInput(first.sessionId, 'fresh-quote'));
  const freshDecision = { ...decision, quoteId: fresh.id };
  const recorded = service.decision(freshDecision);
  assert.equal(recorded.paymentConfirmed, false);
  assert.equal(recorded.orderCreated, false);
  clock = fresh.expiresAt + 1;
  assert.deepEqual(service.decision(freshDecision), recorded);
  assert.throws(
    () => service.decision({ ...freshDecision, choice: 'would_buy_card' }),
    /retry must match/,
  );
  assert.equal(service.report().cohorts.automated.statedCryptoIntent, 1);
  assert.equal(service.report().confirmedPayments, 0);
});

test('merch persistence separates automated, incentivized and organic-labelled intent without claiming demand', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'merch-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'merch.sqlite');
  for (const [cohort, choice, reason] of [
    ['automated', 'would_buy_crypto', 'none'],
    ['incentivized', 'would_buy_card', 'payment'],
    ['organic', 'would_not_buy', 'price'],
  ]) {
    const service = new MerchService(path, { cohort });
    try {
      const { sessionId } = service.open({ requestKey: cohort });
      const quote = service.quote(quoteInput(sessionId));
      service.decision({ sessionId, quoteId: quote.id, choice, reason });
    } finally {
      service.close();
    }
  }
  const service = new MerchService(path);
  t.after(() => service.close());
  const report = service.report();
  assert.equal(report.cohorts.automated.statedCryptoIntent, 1);
  assert.equal(report.cohorts.incentivized.statedCardPreference, 1);
  assert.equal(report.cohorts.organic.statedCryptoIntent, 0);
  assert.equal(report.cohorts.organic.wouldNotBuy, 1);
  assert.equal(report.cohorts.organic.reasons.price, 1);
  assert.equal(report.cohorts.unknown.sessions, 0);
  assert.equal(report.orders, 0);
  assert.equal(report.demandValidated, false);
  assert.throws(() => service.open({ requestKey: 'organic' }), /different cohort/);
});

test('an official MCP client can shop through the merch service and retrieve honest evidence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'merch-mcp-test-'));
  const client = new Client({ name: 'merch-test-client', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../examples/proof-of-reps/mcp.mjs', import.meta.url))],
      env: { ...process.env, MERCH_DB: join(directory, 'merch.sqlite'), MERCH_COHORT: 'automated' },
      stderr: 'pipe',
    }),
  );
  assert.equal((await client.listTools()).tools.length, 5);
  async function call(name, input) {
    const result = await client.callTool({ name, arguments: input });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  const { sessionId } = await call('merch_open', { requestKey: 'mcp-shopper' });
  const matches = await call('merch_recommend', {
    sessionId,
    activity: 'strength',
    size: 'M',
    budgetCents: 4000,
  });
  assert.equal(matches.products.length, 2);
  const quote = await call('merch_quote', quoteInput(sessionId));
  await call('merch_record_intent', {
    sessionId,
    quoteId: quote.id,
    choice: 'would_not_buy',
    reason: 'price',
  });
  const report = await call('merch_report', {});
  assert.equal(report.cohorts.automated.wouldNotBuy, 1);
  assert.equal(report.cohorts.organic.sessions, 0);
  assert.equal(report.confirmedPayments, 0);
  const badQuote = await client.callTool({
    name: 'merch_quote',
    arguments: { ...quoteInput(sessionId), quantity: 99 },
  });
  assert.equal(badQuote.isError, true);
});
