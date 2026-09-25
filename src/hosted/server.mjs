import { resolve, join } from 'node:path';
import { HostedStore } from './store.mjs';
import { workflowFactory } from './runtime.mjs';
import { hostedServer } from './http.mjs';
import { runJob } from './worker.mjs';

process.umask(0o077);
const directory = resolve(process.env.LAUNCHLAB_HOSTED_DATA || '.data/hosted');
const configPath = resolve(process.env.LAUNCHLAB_MANAGED_CONFIG || 'deploy/managed-hosting.json');
const store = new HostedStore(join(directory, 'service.sqlite'));
const workflows = workflowFactory({ directory, configPath, store });
if (process.argv[2] === 'worker') {
  // Production ExecStart holds OS flock for the entire worker process lifetime.
  store.recover(); store.heartbeat();
  const heartbeat = setInterval(() => store.heartbeat(), 5000);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
  while (!stopping) {
    const job = store.claim();
    if (job) await runJob(store, workflows, job);
    else await new Promise((done) => setTimeout(done, 500));
  }
  clearInterval(heartbeat); store.close();
} else {
  const server = hostedServer({ store, workflows });
  server.listen(Number(process.env.LAUNCHLAB_HOSTED_PORT || 4314), '127.0.0.1', () => console.log('LaunchLab hosted API is listening on loopback.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
