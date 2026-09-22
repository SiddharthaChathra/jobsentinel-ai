import type {
  AIProvider,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from '../provider';

export interface ClaudeAdapterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ClaudeResponse {
  content?: { type: string; text?: string; input?: unknown; name?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
  stop_reason?: string;
}

/**
 * Claude via the Messages API. Strict JSON is obtained with forced tool use: the output schema
 * becomes the single tool's input schema, and the tool call's `input` is the structured result.
 */
export class ClaudeAdapter implements AIProvider {
  readonly name = 'claude';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ClaudeAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async complete(req: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const body = {
      model: this.model,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      tools: [
        { name: 'emit', description: 'Emit the structured result.', input_schema: req.jsonSchema },
      ],
      tool_choice: { type: 'tool', name: 'emit' },
    };
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as ClaudeResponse;
    if (!res.ok) throw new Error(`claude ${res.status}: ${json.error?.message ?? res.statusText}`);
    const tool = json.content?.find((c) => c.type === 'tool_use');
    const text = tool
      ? JSON.stringify(tool.input)
      : (json.content?.find((c) => c.type === 'text')?.text ?? '');
    if (!text)
      throw new Error(`claude returned no content (stop_reason=${json.stop_reason ?? 'unknown'})`);
    return {
      text,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models/${this.model}`, {
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
