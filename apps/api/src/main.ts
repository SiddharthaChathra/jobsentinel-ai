import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { loadEnv } from '@jobsentinel/config';
import { AppModule } from './app.module';
import { createLogger } from './common/logging/logger';
import { PinoNestLogger } from './common/logging/nest-logger';
import { APP_VERSION } from './version';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast before Nest boots
  const logger = createLogger(env, 'api');

  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger(logger) });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.info({ port: env.PORT, version: APP_VERSION, env: env.NODE_ENV }, 'api listening');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
