import express from 'express';
import { z, ZodError } from 'zod';
import { x402ResourceServer, paymentMiddlewareFromHTTPServer } from '@okxweb3/x402-express';
import { x402HTTPResourceServer } from '@okxweb3/x402-core/http';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import { exampleSnapshot, repositorySnapshot } from './repos.mjs';
import { requireThat } from './store.mjs';

const inputSchema = z
  .object({
    repoUrl: z.string().url().max(300).optional(),
    ref: z.string().min(1).max(200).optional(),
  })
  .strict();
export async function readinessResult(input) {
  const snapshot = input.repoUrl
    ? await repositorySnapshot(input.repoUrl, input.ref)
    : await exampleSnapshot();
  return {
    service: 'launchlab-static-readiness',
    schemaVersion: 1,
    source: {
      kind: snapshot.kind,
      repoUrl: snapshot.repoUrl,
      commitSha: snapshot.commitSha,
      digest: snapshot.digest,
    },
    project: snapshot.manifest.name,
    adapter: 'static',
    configuredChainId: snapshot.manifest.chainId,
    packageReady: true,
    deployed: false,
    productionReady: false,
    checks: [
      { name: 'Manifest schema', passed: true },
      { name: 'Pinned source and listed files', passed: true },
      {
        name: 'Bounded static package',
        passed: true,
        fileCount: Object.keys(snapshot.files).length,
      },
    ],
    nextAction:
      'Import this pinned source into LaunchLab and run launchlab_deploy to prepare and verify a local preview.',
    limitations: [
      'Static package inspection only; no code execution or contract audit.',
      'No deployment, user recruitment or payout is included in this API call.',
    ],
  };
}
export async function createSeller({
  mode = 'free',
  facilitator,
  payTo,
  network = 'eip155:1952',
  price = '$0.01',
  inspect = readinessResult,
} = {}) {
  requireThat(['free', 'x402'].includes(mode), 'SELLER_MODE must be free or x402.');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', mode, service: 'launchlab-static-readiness' }),
  );
  // Validate request shape before presenting a payment challenge.
  app.post('/v1/readiness', (req, _res, next) => {
    try {
      req.body = inputSchema.parse(req.body === undefined ? {} : req.body);
      next();
    } catch (error) {
      next(error);
    }
  });
  if (mode === 'x402') {
    requireThat(
      /^0x[a-fA-F0-9]{40}$/.test(payTo || '') && !/^0x0{40}$/.test(payTo),
      'A nonzero PAY_TO_ADDRESS is required.',
    );
    requireThat(
      ['eip155:1952', 'eip155:196'].includes(network),
      'Only X Layer testnet or mainnet is supported.',
    );
    requireThat(
      /^\$(?:0\.\d{1,6}|[1-9]\d*(?:\.\d{1,6})?)$/.test(price) && Number(price.slice(1)) > 0,
      'Use a positive USD price string.',
    );
    requireThat(facilitator, 'An authenticated OKX facilitator is required in paid mode.');
    const resources = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
    const http = new x402HTTPResourceServer(resources, {
      'POST /v1/readiness': {
        accepts: [{ scheme: 'exact', network, payTo, price }],
        description:
          'Inspect a pinned static project package for LaunchLab compatibility. No deployment included.',
        mimeType: 'application/json',
      },
    });
    await http.initialize();
    app.use(paymentMiddlewareFromHTTPServer(http, undefined, undefined, false));
  }
  app.post('/v1/readiness', async (req, res, next) => {
    try {
      res.json(await inspect(req.body));
    } catch (error) {
      next(error);
    }
  });
  app.use((error, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error.status || 502;
    res
      .status(status)
      .json({
        error:
          error instanceof ZodError
            ? 'Invalid readiness request.'
            : status >= 500
              ? 'Readiness service unavailable. No successful report was delivered.'
              : error.message,
      });
  });
  return app;
}
export function sellerConfiguration(env) {
  const mode = env.SELLER_MODE || 'free';
  requireThat(['free', 'x402'].includes(mode), 'SELLER_MODE must be free or x402.');
  if (mode === 'free') return { mode };
  for (const key of ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE', 'PAY_TO_ADDRESS'])
    requireThat(env[key], `${key} is required in paid mode.`);
  const network = env.PAYMENT_NETWORK || 'eip155:1952';
  requireThat(
    network !== 'eip155:196' || env.ALLOW_MAINNET === 'true',
    'Mainnet requires ALLOW_MAINNET=true. Default is testnet.',
  );
  return {
    mode,
    network,
    payTo: env.PAY_TO_ADDRESS,
    price: env.READINESS_PRICE || '$0.01',
    facilitator: new OKXFacilitatorClient({
      apiKey: env.OKX_API_KEY,
      secretKey: env.OKX_SECRET_KEY,
      passphrase: env.OKX_PASSPHRASE,
      syncSettle: true,
    }),
  };
}
