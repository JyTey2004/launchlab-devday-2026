import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Domain } from './domain.mjs';
import { Services } from './services.mjs';
import { apiServer, previewServer, listen } from './http.mjs';
import { ManagedPipeline } from './managed/pipeline.mjs';
import { AgentExperiments } from './agent/experiments.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.env.LAUNCHLAB_DATA_DIR || join(root, '.data'));
const store = new Store(join(data, 'launchlab.sqlite'));
const domain = new Domain(store);
const preview = previewServer(join(data, 'artifacts'));
const previewPort = await listen(preview, Number(process.env.PREVIEW_PORT || 4311));
const services = new Services(domain, join(data, 'artifacts'), `http://127.0.0.1:${previewPort}`);
const managed = process.env.LAUNCHLAB_MANAGED_ENABLED === 'true' ? new ManagedPipeline() : null;
const agent = managed ? new AgentExperiments({ pipeline: managed }) : null;
const server = apiServer(domain, services, process.env.LAUNCHLAB_API_TOKEN, managed, agent);
await listen(server, Number(process.env.PORT || 4310));
console.log(`LaunchLab: http://127.0.0.1:${server.address().port}`);
console.log(`Validation agent: http://127.0.0.1:${server.address().port}/agent (${agent?.status().configured ? 'OpenAI configured; not yet verified' : 'add OPENAI_API_KEY to the private .env file'})`);
console.log(`Preview origin: http://127.0.0.1:${previewPort} (isolated, static files only)`);
console.log(
  `Mode: local operator; rewards are demo credits. Managed AWS hosting ${managed ? 'enabled (operator token required)' : 'disabled'}. No on-chain settlement.`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close();
    preview.close();
    store.close();
    process.exit(0);
  });
