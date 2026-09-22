import { Global, Logger, Module } from '@nestjs/common';
import { AIService, buildProvidersFromEnv, type AIProvider } from '@jobsentinel/ai';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../config/config.module';
import { DB, type Db } from '../db/db.module';
import { DbBudget, DbCache } from './db-ai';

export const AI_SERVICE = Symbol('AI_SERVICE');
export const AI_BUDGET = Symbol('AI_BUDGET');

/** Cached answers older than this are re-asked: a posting's requirements can be re-edited. */
const CACHE_MAX_AGE_DAYS = 30;

/**
 * Provides `AIService | null`: null when no provider key is configured, so every caller has an
 * explicit deterministic path (docs 09 §1).
 *
 * Budget and cache are backed by `ai_calls`, not by process memory: the worker runs as a
 * short-lived `--once` process, so an in-process counter would reset the daily cap every tick
 * and an in-process cache would never survive to save a call (docs 09 §6).
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_BUDGET,
      useFactory: (env: Env, db: Db) =>
        new DbBudget(db, env.AI_DAILY_CALL_BUDGET, env.AI_DAILY_TOKEN_BUDGET),
      inject: [ENV, DB],
    },
    {
      provide: AI_SERVICE,
      useFactory: (env: Env, db: Db, budget: DbBudget): AIService | null => {
        const logger = new Logger('AIService');
        const providers: AIProvider[] = buildProvidersFromEnv(env);
        if (providers.length === 0) {
          logger.warn('no AI provider configured — deterministic fallbacks only');
          return null;
        }
        logger.log(`AI providers: ${providers.map((p) => `${p.name}/${p.model}`).join(' → ')}`);
        return new AIService(providers, budget, new DbCache(db, CACHE_MAX_AGE_DAYS), {
          info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
          warn: (obj, msg) => logger.warn(`${msg} ${JSON.stringify(obj)}`),
        });
      },
      inject: [ENV, DB, AI_BUDGET],
    },
  ],
  exports: [AI_SERVICE, AI_BUDGET],
})
export class AiModule {}
