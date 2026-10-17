import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { decideAutoPause } from '@jobsentinel/validation';
import { SourceReportService } from '../sources/source-report.service';
import { WorkerModule } from '../worker.module';

/**
 * Prints the source report card and which sources auto-pause would pause — read-only
 * (`pnpm source-report [--days=7|30] [--at=2026-10-23]`). `--at` previews a future date (D103).
 */
async function main(): Promise<void> {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const days = arg('days') === '7' ? 7 : 30;
  const at = arg('at') ? new Date(arg('at')!) : new Date();
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const report = await app.get(SourceReportService).report(days, at);
    const health: Record<string, number> = {};
    const wouldPause: string[] = [];
    for (const s of report.sources) {
      health[s.health] = (health[s.health] ?? 0) + 1;
      const d = decideAutoPause({
        status: s.status,
        createdAt: new Date(s.createdAt),
        resumedAt: s.resumedAt ? new Date(s.resumedAt) : null,
        last30: s,
        now: at,
      });
      if (d.pause) wouldPause.push(`${s.name}: ${d.reason}`);
    }
    console.warn(
      `${at.toISOString().slice(0, 10)}, last ${days} days: collected ${report.totals.collected}, ` +
        `kept ${report.totals.kept}. Health: ${JSON.stringify(health)}`,
    );
    for (const s of [...report.sources].sort((a, b) => b.collected - a.collected).slice(0, 12)) {
      console.warn(
        `  ${s.health.padEnd(17)} ${String(s.kept).padStart(3)}/${String(s.collected).padEnd(4)} ${s.name}`,
      );
    }
    console.warn(
      `Auto-pause would pause ${wouldPause.length}${days === 30 ? '' : ' (30-day rule)'}:`,
    );
    for (const p of wouldPause) console.warn(`  - ${p}`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
