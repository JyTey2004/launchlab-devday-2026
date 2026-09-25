import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeller, sellerConfiguration } from '../src/seller.mjs';
import { listen } from '../src/http.mjs';
import { createServer } from 'node:http';
async function start(t, options) {
  const app = await createSeller(options);
  const server = createServer(app);
  const port = await listen(server, 0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (input) =>
    fetch(`http://127.0.0.1:${port}/v1/readiness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(input?.headers || {}) },
      body: input?.omitBody ? undefined : JSON.stringify(input?.body || {}),
    });
}
test('free readiness service returns a bounded report without pretending to deploy', async (t) => {
  const post = await start(t, { mode: 'free' });
  const response = await post();
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.packageReady, true);
  assert.equal(report.deployed, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.configuredChainId, 1952);
});
test('official x402 SDK emits v2 challenge and never delivers on an invalid payment', async (t) => {
  let calls = 0;
  let settled = false;
  const facilitator = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:1952' }],
      extensions: [],
      signers: {},
    }),
    verify: async () => ({ isValid: false, invalidReason: 'test-invalid-signature' }),
    settle: async () => {
      settled = true;
      throw new Error('Must never settle invalid payment');
    },
  };
  const post = await start(t, {
    mode: 'x402',
    facilitator,
    payTo: '0x1111111111111111111111111111111111111111',
    inspect: async () => {
      calls++;
      return {};
    },
  });
  const response = await post();
  assert.equal(response.status, 402);
  const challenge = JSON.parse(
    Buffer.from(response.headers.get('payment-required'), 'base64').toString(),
  );
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.accepts[0].network, 'eip155:1952');
  assert.equal(challenge.accepts[0].amount, '10000');
  const invalid = await post({ headers: { 'payment-signature': 'not-a-valid-payload' } });
  assert.equal(invalid.status, 402);
  const replay = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: challenge.resource,
      accepted: challenge.accepts[0],
      payload: {},
    }),
  ).toString('base64');
  assert.equal((await post({ headers: { 'payment-signature': replay } })).status, 402);
  assert.equal(calls, 0);
  assert.equal(settled, false);
});
test('paid mode fails closed without credentials or mainnet opt-in', async () => {
  assert.throws(() => sellerConfiguration({ SELLER_MODE: 'x402' }), /OKX_API_KEY/);
  assert.throws(() => sellerConfiguration({ SELLER_MODE: 'typo' }), /SELLER_MODE/);
  assert.throws(
    () =>
      sellerConfiguration({
        SELLER_MODE: 'x402',
        OKX_API_KEY: 'test',
        OKX_SECRET_KEY: 'test',
        OKX_PASSPHRASE: 'test',
        PAY_TO_ADDRESS: '0x1111111111111111111111111111111111111111',
        PAYMENT_NETWORK: 'eip155:196',
      }),
    /ALLOW_MAINNET/,
  );
  await assert.rejects(() => createSeller({ mode: 'x402' }), /PAY_TO_ADDRESS/);
});

// These use the real HTTP middleware with a simulated facilitator, never a wallet
// signature or blockchain transaction. A passing test is not settlement evidence.
function simulatedFacilitator({ settlementFails = false } = {}) {
  return {
    verified: 0,
    settled: 0,
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:1952' }],
      extensions: [],
      signers: {},
    }),
    async verify() {
      this.verified++;
      return { isValid: true, payer: '0x2222222222222222222222222222222222222222' };
    },
    async settle() {
      this.settled++;
      return {
        success: !settlementFails,
        status: settlementFails ? 'failed' : 'success',
        errorReason: settlementFails ? 'simulated-settlement-failure' : undefined,
        transaction: '',
        network: 'eip155:1952',
      };
    },
  };
}
test('bodyless POST uses the built-in example for both free and paid clients', async (t) => {
  for (const mode of ['free', 'x402']) {
    const facilitator = simulatedFacilitator();
    const post = await start(t, {
      mode,
      facilitator,
      payTo: '0x1111111111111111111111111111111111111111',
    });
    const response = await post({ omitBody: true });
    assert.equal(response.status, mode === 'free' ? 200 : 402);
    if (mode === 'free') assert.equal((await response.json()).packageReady, true);
    else assert.ok(response.headers.get('payment-required'));
    assert.equal(facilitator.verified, 0);
    assert.equal(facilitator.settled, 0);
  }
});
async function simulatedReplay(post) {
  const response = await post();
  assert.equal(response.status, 402);
  const challenge = JSON.parse(
    Buffer.from(response.headers.get('payment-required'), 'base64').toString(),
  );
  return {
    headers: {
      'payment-signature': Buffer.from(
        JSON.stringify({
          x402Version: 2,
          resource: challenge.resource,
          accepted: challenge.accepts[0],
          payload: { fixture: 'no-real-signature' },
        }),
      ).toString('base64'),
    },
  };
}
test('successful simulated settlement delivers the report and receipt through the real SDK', async (t) => {
  const facilitator = simulatedFacilitator();
  let inspections = 0;
  const post = await start(t, {
    mode: 'x402',
    facilitator,
    payTo: '0x1111111111111111111111111111111111111111',
    inspect: async () => {
      inspections++;
      return { marker: 'local-only-report', deployed: false };
    },
  });
  const request = await simulatedReplay(post);
  assert.equal(inspections, 0);
  const response = await post(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { marker: 'local-only-report', deployed: false });
  const receipt = JSON.parse(
    Buffer.from(response.headers.get('payment-response'), 'base64').toString(),
  );
  assert.equal(receipt.network, 'eip155:1952');
  assert.equal(receipt.status, 'success');
  assert.equal(facilitator.verified, 1);
  assert.equal(facilitator.settled, 1);
  assert.equal(inspections, 1);
});
test('a failed simulated settlement withholds the computed report from the buyer', async (t) => {
  const facilitator = simulatedFacilitator({ settlementFails: true });
  const post = await start(t, {
    mode: 'x402',
    facilitator,
    payTo: '0x1111111111111111111111111111111111111111',
    inspect: async () => ({ marker: 'must-not-be-delivered' }),
  });
  const response = await post(await simulatedReplay(post));
  assert.equal(response.status, 402);
  assert.ok(!(await response.text()).includes('must-not-be-delivered'));
  assert.equal(facilitator.settled, 1);
});
test('a report failure returns a bounded error and never requests settlement', async (t) => {
  const facilitator = simulatedFacilitator();
  const post = await start(t, {
    mode: 'x402',
    facilitator,
    payTo: '0x1111111111111111111111111111111111111111',
    inspect: async () => {
      throw new Error('fixture-private-error');
    },
  });
  const response = await post(await simulatedReplay(post));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('fixture-private-error'));
  assert.equal(response.headers.get('payment-response'), null);
  assert.equal(facilitator.verified, 1);
  assert.equal(facilitator.settled, 0);
});
test('malformed input is rejected before a payment challenge or facilitator verification', async (t) => {
  const facilitator = simulatedFacilitator();
  const post = await start(t, {
    mode: 'x402',
    facilitator,
    payTo: '0x1111111111111111111111111111111111111111',
  });
  const response = await post({ body: { repoUrl: 'invalid-url' } });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('payment-required'), null);
  assert.equal(facilitator.verified, 0);
  assert.equal(facilitator.settled, 0);
});
