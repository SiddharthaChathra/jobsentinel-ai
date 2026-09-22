import type {
  AIProvider,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from '../provider';

export interface GeminiAdapterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Only sent when set; Lite models reject thinkingConfig, thinking models default to dynamic. */
  thinkingBudget?: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

/**
 * Gemini via the REST API (no SDK: fewer deps, trivially mockable).
 * Uses JSON mode with `responseJsonSchema`; thinking is disabled for structured extraction
 * so the output budget is not consumed by reasoning tokens (docs 09 §2, D8).
 */
export class GeminiAdapter implements AIProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly thinkingBudget: number | undefined;

  constructor(opts: GeminiAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/,
      '',
    );
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.thinkingBudget = opts.thinkingBudget;
  }

  async complete(req: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: sanitizeSchemaForGemini(req.jsonSchema),
        ...(this.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: this.thinkingBudget } }
          : {}),
      },
    };
    const res = await this.fetchImpl(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw new Error(`gemini ${res.status}: ${json.error?.message ?? res.statusText}`);
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text)
      throw new Error(
        `gemini returned no text (finishReason=${json.candidates?.[0]?.finishReason ?? 'unknown'})`,
      );
    return {
      text,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens:
          (json.usageMetadata?.candidatesTokenCount ?? 0) +
          (json.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models/${this.model}`, {
        headers: { 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Gemini's responseJsonSchema accepts a JSON-Schema subset. Verified live (2026-09-22) against
 * gemini-3.5-flash-lite: `maxItems`/`minItems` → 400; `$schema`, `default`, `additionalProperties`
 * are dropped defensively. minimum/maximum/minLength/maxLength/enum/anyOf are accepted.
 * Zod still enforces the full schema on the way back, so nothing is lost.
 */
const UNSUPPORTED_KEYS = new Set([
  '$schema',
  '$id',
  'default',
  'additionalProperties',
  'maxItems',
  'minItems',
]);

export function sanitizeSchemaForGemini(schema: unknown): Record<string, unknown> {
  return walk(schema) as Record<string, unknown>;
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  }
  return node;
}
