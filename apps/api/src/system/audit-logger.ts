import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LogLevel } from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { systemLogs } from '../common/db/schema';

export type LogCategory =
  'SCAN' | 'PIPELINE' | 'VALIDATION' | 'AI' | 'NOTIFY' | 'AUTH' | 'API' | 'WORKER' | 'HOUSEKEEPING';

/**
 * Business-significant events → `system_logs` (docs 05 §8). Never throws: a logging failure
 * must not break the pipeline. Never receives resume text, tokens or full descriptions.
 */
@Injectable()
export class AuditLogger {
  private readonly logger = new Logger(AuditLogger.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async event(
    category: LogCategory,
    message: string,
    context: Record<string, unknown> = {},
    opts: { level?: LogLevel; sourceId?: string; jobId?: string; userId?: string } = {},
  ): Promise<void> {
    try {
      await this.db.insert(systemLogs).values({
        level: opts.level ?? 'INFO',
        category,
        message,
        context,
        sourceId: opts.sourceId ?? null,
        jobId: opts.jobId ?? null,
        userId: opts.userId ?? null,
      });
    } catch (err) {
      this.logger.warn(`audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
