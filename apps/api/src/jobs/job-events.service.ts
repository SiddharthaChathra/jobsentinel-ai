import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../common/db/db.module';
import { jobEvents } from '../common/db/schema';

export type JobEventType =
  | 'DISCOVERED'
  | 'UPDATED'
  | 'DEDUPED'
  | 'DEDUPED_FUZZY'
  | 'CLASSIFIED'
  | 'FILTERED_OUT'
  | 'VALIDATED'
  | 'MATCHED'
  | 'NOTIFIED'
  | 'RECHECKED'
  | 'EXPIRED'
  | 'USER_REVIEWED'
  | 'STAGE_ERROR';

/** Per-job audit trail shown on the job detail page (docs 02 §3.5). */
@Injectable()
export class JobEventsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    jobId: string,
    type: JobEventType,
    detail: Record<string, unknown> = {},
    tx: Db = this.db,
  ): Promise<void> {
    await tx.insert(jobEvents).values({ jobId, type, detail });
  }
}
