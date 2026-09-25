import { join } from 'node:path';
import { ManagedPipeline } from '../managed/pipeline.mjs';
import { AgentExperiments } from '../agent/experiments.mjs';
import { AgentWorkflows } from '../agent/workflows.mjs';
import { OpenAIClient } from '../agent/openai.mjs';
import { tenantId } from './store.mjs';

export function workflowFactory({ directory, configPath, store }) {
  return (tenant) => {
    const root = join(directory, 'tenants', tenantId(tenant));
    const pipeline = new ManagedPipeline({ directory: join(root, 'managed'), experimentDirectory: join(root, 'experiments'), configPath });
    // Hosted MVP accepts public GitHub repositories only. No personal gh login.
    pipeline.token = async () => undefined;
    pipeline.start = (id, approval) => pipeline.authorize(id, approval);
    const client = new OpenAIClient(), generate = client.generate.bind(client);
    client.generate = async (input) => { store.reserveModelCall(tenant); return generate(input); };
    const service = new AgentWorkflows({ agent: new AgentExperiments({ pipeline, client }) });
    const view = service.view.bind(service);
    service.view = async (record) => {
      const result = await view(record);
      result.limitations[0] = 'Invite-only hosted demo with per-caller access; not yet an OKX AI listing.';
      if (result.plan) result.plan.hostedLimits = { maximumDeployments: store.limits.deployments, dailyModelCalls: store.limits.tenantDailyModelCalls, automaticExpiry: false, hardCurrencyCap: false };
      return result;
    };
    return service;
  };
}
