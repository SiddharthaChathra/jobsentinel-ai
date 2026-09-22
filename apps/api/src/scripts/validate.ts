import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationOrchestrator } from '../validation/validation.orchestrator';
import { WorkerModule } from '../worker.module';

/**
 * Drains the validation queue (`pnpm validate [--batch=N] [--ai=N] [--recheck]`).
 * Each job costs at least one real HTTP request to the employer's application page, so the
 * default batch is deliberately small and HttpClient's per-host politeness still applies.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const num = (flag: string, fallback: number) => {
    const a = args.find((x) => x.startsWith(`--${flag}=`));
    return a ? Number(a.slice(flag.length + 3)) : fallback;
  };
  const batch = num('batch', 40);
  const maxAiCalls = num('ai', 0);
  const recheck = args.includes('--recheck');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const svc = app.get(ValidationOrchestrator);
    if (recheck) {
      const r = await svc.recheckDue({ batch });
      console.warn(`recheck: ${JSON.stringify(r)}`);
      return;
    }
    const result = await svc.validatePending({ batch, maxAiCalls, timeBudgetMs: 15 * 60_000 });
    console.warn(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
