import { forwardRef, Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SourcesModule } from '../sources/sources.module';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemModule } from '../system/system.module';
import { ValidationModule } from '../validation/validation.module';
import { HousekeepingService } from './housekeeping.service';
import { RecoveryService } from './recovery.service';
import { SchedulerService } from './scheduler.service';
import { WorkerLoop } from './worker-loop';

@Module({
  imports: [
    forwardRef(() => SourcesModule),
    SystemModule,
    JobsModule,
    ValidationModule,
    MatchingModule,
    NotificationsModule,
  ],
  providers: [SchedulerService, RecoveryService, HousekeepingService, WorkerLoop],
  exports: [SchedulerService, RecoveryService, HousekeepingService, WorkerLoop],
})
export class SchedulerModule {}
