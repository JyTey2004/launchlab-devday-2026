import { createSeller, sellerConfiguration } from './seller.mjs';
const app = await createSeller(sellerConfiguration(process.env));
const port = Number(process.env.SELLER_PORT || 4312);
app.listen(port, '127.0.0.1', () =>
  console.log(
    `LaunchLab readiness seller: http://127.0.0.1:${port}/v1/readiness (separate from operator API)`,
  ),
);
