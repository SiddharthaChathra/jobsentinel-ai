import type { Env } from '@jobsentinel/config';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import type { AIProvider } from './provider';

/**
 * Builds the provider chain from env: AI_PROVIDER first, then AI_FALLBACK_PROVIDERS, skipping
 * providers whose key is missing. Returns [] when no provider is configured (callers then use
 * deterministic fallbacks only). `local` arrives with the LocalModelAdapter (backlog).
 */
export function buildProvidersFromEnv(env: Env): AIProvider[] {
  const order = [env.AI_PROVIDER, ...env.AI_FALLBACK_PROVIDERS].filter(
    (p, i, a) => a.indexOf(p) === i,
  );
  const providers: AIProvider[] = [];
  for (const name of order) {
    if (name === 'gemini' && env.AI_GEMINI_API_KEY) {
      providers.push(
        new GeminiAdapter({ apiKey: env.AI_GEMINI_API_KEY, model: env.AI_GEMINI_MODEL }),
      );
    } else if (name === 'claude' && env.AI_CLAUDE_API_KEY) {
      providers.push(
        new ClaudeAdapter({ apiKey: env.AI_CLAUDE_API_KEY, model: env.AI_CLAUDE_MODEL }),
      );
    }
  }
  return providers;
}
