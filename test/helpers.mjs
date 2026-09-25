import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Domain } from '../src/domain.mjs';
import { Services } from '../src/services.mjs';
import { apiServer, previewServer, listen } from '../src/http.mjs';
export async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'launchlab-test-'));
  const store = new Store(join(path, 'test.sqlite'));
  const domain = new Domain(store);
  const preview = previewServer(join(path, 'artifacts'));
  const previewPort = await listen(preview, 0);
  const services = new Services(domain, join(path, 'artifacts'), `http://127.0.0.1:${previewPort}`);
  const server = apiServer(domain, services, 'test-token-for-agent');
  const port = await listen(server, 0);
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => preview.close(r))]);
    store.close();
    await rm(path, { recursive: true, force: true });
  });
  return { path, store, domain, services, server, preview, origin };
}
export async function campaign(services, budget = 20, reward = 10) {
  const project = await services.importProject();
  const release = await services.deploy(project.id);
  const result = await services.createCampaign({
    releaseId: release.id,
    title: 'First-use experiment',
    audience: 'Agent builders',
    task: 'Try finding a useful agent service and describe where you get stuck.',
    budget,
    reward,
  });
  return { project, release, campaign: result };
}
export const negativeFeedback = {
  outcome: 'blocked',
  steps: 'I selected the protocol guide and entered my integration question.',
  observation: 'The request was prepared but there was no agent execution, which confused me.',
  suggestion: 'Make the endpoint of this prototype clearer before I start.',
  rating: 1,
};
