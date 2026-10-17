import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { Env } from '@jobsentinel/config';
import { decideAutoPause } from '@jobsentinel/validation';
import { ENV } from '../common/config/config.module';
import { SourceReportService } from '../sources/source-report.service';
import { WorkerModule } from '../worker.module';

/**
 * Prints the source report card and what auto-pause WOULD do — read-only, nothing is changed
 * (`pnpm source-report [--days=7|30] [--at=2026-10-23T12:00:00Z]`). `--at` previews a date, using
 * the deployed AUTO_PAUSE_MIN_COLLECTED / AUTO_PAUSE_WINDOW_DAYS (D103, D104).
 */
async function main(): Promise<void> {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const days = arg('days') === '7' ? 7 : 30;
  const at = arg('at') ? new Date(arg('at')!) : new Date();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const env = app.get<Env>(ENV);
    const svc = app.get(SourceReportService);
    const report = await svc.report(days, at);
    const health: Record<string, number> = {};
    for (const s of report.sources) health[s.health] = (health[s.health] ?? 0) + 1;
    console.warn(
      `${at.toISOString().slice(0, 10)}, last ${days} days: collected ${report.totals.collected}, ` +
        `kept ${report.totals.kept}. Health: ${JSON.stringify(health)}`,
    );

    const windowDays = env.AUTO_PAUSE_WINDOW_DAYS;
    const window = await svc.report(windowDays, at);
    const lines = { PAUSE: [] as string[], ALERT: [] as string[], SPARED: [] as string[] };
    for (const s of window.sources) {
      const d = decideAutoPause({
        status: s.status,
        createdAt: new Date(s.createdAt),
        resumedAt: s.resumedAt ? new Date(s.resumedAt) : null,
        window: s,
        now: at,
        minCollected: env.AUTO_PAUSE_MIN_COLLECTED,
        windowDays,
        exempt: s.pauseExempt,
      });
      if (d.action !== 'NONE') lines[d.action].push(`${s.name}: ${d.reason}`);
      else if (d.why === 'TOO_FEW' && s.kept === 0 && s.collected > 0) {
        lines.SPARED.push(`${s.name}: only ${s.collected} collected`);
      }
    }
    console.warn(
      `\nRule: ${env.AUTO_PAUSE_MIN_COLLECTED}+ collected and 0 kept over ${windowDays} days; ` +
        `India-scoped sources alert instead of pausing.`,
    );
    for (const [label, list] of [
      ['WOULD PAUSE', lines.PAUSE],
      ['WOULD ALERT (India-scoped, not paused)', lines.ALERT],
      ['SPARED (too few jobs to judge)', lines.SPARED],
    ] as const) {
      console.warn(`\n${label}: ${list.length}`);
      for (const l of list) console.warn(`  - ${l}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
