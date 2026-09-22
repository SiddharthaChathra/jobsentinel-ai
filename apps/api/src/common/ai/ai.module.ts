import { Global, Logger, Module } from '@nestjs/common';
import {
  AIService,
  InMemoryBudget,
  InMemoryCache,
  buildProvidersFromEnv,
  type AIProvider,
} from '@jobsentinel/ai';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../config/config.module';

export const AI_SERVICE = Symbol('AI_SERVICE');

/**
 * Provides `AIService | null`: null when no provider key is configured, so every caller has an
 * explicit deterministic path (docs 09 §1). Budget/cache are in-memory until Phase 3 adds ai_calls.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_SERVICE,
      useFactory: (env: Env): AIService | null => {
        const logger = new Logger('AIService');
        const providers: AIProvider[] = buildProvidersFromEnv(env);
        if (providers.length === 0) {
          logger.warn('no AI provider configured — deterministic fallbacks only');
          return null;
        }
        logger.log(`AI providers: ${providers.map((p) => `${p.name}/${p.model}`).join(' → ')}`);
        return new AIService(
          providers,
          new InMemoryBudget(env.AI_DAILY_CALL_BUDGET),
          new InMemoryCache(),
          {
            info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
            warn: (obj, msg) => logger.warn(`${msg} ${JSON.stringify(obj)}`),
          },
        );
      },
      inject: [ENV],
    },
  ],
  exports: [AI_SERVICE],
})
export class AiModule {}
