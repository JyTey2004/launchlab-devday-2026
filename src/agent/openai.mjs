import { jsonSchema } from './schemas.mjs';
import { requireThat } from '../store.mjs';

// Operator process only. This module and its key never enter the build package.
export class OpenAIClient {
  constructor({ key = process.env.OPENAI_API_KEY, model = process.env.LAUNCHLAB_OPENAI_MODEL || 'gpt-5.4-2026-03-05', fetcher = fetch } = {}) {
    Object.assign(this, { key, model, fetcher });
  }
  status() { return { configured: Boolean(this.key?.trim()), model: this.model, provider: 'openai', maxCallsPerPlan: 2, maxOutputTokensPerCall: 6000 }; }
  async generate({ schema, name, instructions, input }) {
    requireThat(this.key?.trim(), 'Add OPENAI_API_KEY to the private .env file and restart LaunchLab. No model call or deployment was made.', 409);
    const payload = JSON.stringify(input);
    requireThat(payload.length <= 220000, 'Selected context exceeds the model input limit.', 413);
    let response;
    try {
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 6000,
          instructions, input: [{ role: 'user', content: payload }], text: { format: { type: 'json_schema', name, strict: true, schema: jsonSchema(schema) } } }),
      });
    } catch { throw new Error('OpenAI request did not complete. No automatic billing retry was made; inspect the saved experiment before retrying.'); }
    if (!response.ok) {
      const reason = response.status === 401 ? 'Check the server API key.' : response.status === 429 ? 'Check OpenAI quota and rate limits.' : response.status === 404 ? 'Check LAUNCHLAB_OPENAI_MODEL and account model access.' : 'Check model configuration and OpenAI availability.';
      throw new Error(`OpenAI returned HTTP ${response.status}. ${reason}`);
    }
    const data = await response.json();
    requireThat(data.status === 'completed', 'OpenAI returned an incomplete result. No patch was applied.', 422);
    const items = data.output?.filter((o) => o.type === 'message').flatMap((o) => o.content || []) || [];
    requireThat(!items.some((o) => o.type === 'refusal'), 'The model declined this request. No patch was applied.', 422);
    const output = items.filter((o) => o.type === 'output_text').map((o) => o.text).join('');
    let value;
    try { value = schema.parse(JSON.parse(output)); } catch { throw new Error('The model response did not satisfy the experiment contract. No patch was applied.'); }
    return { value, receipt: { provider: 'openai', model: data.model || this.model, responseId: data.id, usage: data.usage, generatedAt: new Date().toISOString() } };
  }
}
