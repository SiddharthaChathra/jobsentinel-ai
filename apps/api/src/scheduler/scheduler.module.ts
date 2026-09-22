import { forwardRef, Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { SystemModule } from '../system/system.module';
import { HousekeepingService } from './housekeeping.service';
import { RecoveryService } from './recovery.service';
import { SchedulerService } from './scheduler.service';
import { WorkerLoop } from './worker-loop';

@Module({
  imports: [forwardRef(() => SourcesModule), SystemModule],
  providers: [SchedulerService, RecoveryService, HousekeepingService, WorkerLoop],
  exports: [SchedulerService, RecoveryService, HousekeepingService, WorkerLoop],
})
export class SchedulerModule {}
