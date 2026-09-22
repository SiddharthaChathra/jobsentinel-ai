import { z } from 'zod';
import { GeminiAdapter, sanitizeSchemaForGemini } from './gemini.adapter';

describe('sanitizeSchemaForGemini', () => {
  it('drops keywords Gemini rejects but keeps constraints it accepts', () => {
    const schema = z.toJSONSchema(
      z.object({
        tags: z.array(z.string().max(10)).max(5).default([]),
        n: z.number().min(1).nullable(),
      }),
      { target: 'draft-7', io: 'input' },
    );
    const out = JSON.stringify(sanitizeSchemaForGemini(schema));
    expect(out).not.toMatch(/maxItems|\$schema|"default"|additionalProperties/);
    expect(out).toMatch(/maxLength/);
    expect(out).toMatch(/minimum/);
    expect(out).toMatch(/anyOf/);
  });
});

describe('GeminiAdapter', () => {
  it('sends JSON mode with the sanitized schema and parses text + usage', async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
        }),
      };
    }) as unknown as typeof fetch;
    const a = new GeminiAdapter({ apiKey: 'k', model: 'm', fetchImpl });
    const r = await a.complete({
      system: 's',
      user: 'u',
      jsonSchema: { type: 'object', maxItems: 3 },
      maxOutputTokens: 10,
      temperature: 0,
    });
    expect(r).toEqual({ text: '{"ok":true}', usage: { inputTokens: 12, outputTokens: 3 } });
    const gen = sentBody.generationConfig as Record<string, unknown>;
    expect(gen.responseMimeType).toBe('application/json');
    expect(gen.responseJsonSchema).toEqual({ type: 'object' });
    expect(gen.thinkingConfig).toBeUndefined();
  });

  it('throws a readable error on non-2xx', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many',
      json: async () => ({ error: { message: 'quota' } }),
    })) as unknown as typeof fetch;
    const a = new GeminiAdapter({ apiKey: 'k', model: 'm', fetchImpl });
    await expect(
      a.complete({ system: 's', user: 'u', jsonSchema: {}, maxOutputTokens: 10, temperature: 0 }),
    ).rejects.toThrow('gemini 429: quota');
  });
});
