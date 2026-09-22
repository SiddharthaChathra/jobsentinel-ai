import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from '@jobsentinel/config';

/** DI token for the validated environment object. Inject with `@Inject(ENV)`. */
export const ENV = Symbol('ENV');

/**
 * Loads and validates the environment exactly once per process (docs 05 §7).
 * `.env` is read via dotenv in main.ts/worker.ts before Nest boots, so here we only parse.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
