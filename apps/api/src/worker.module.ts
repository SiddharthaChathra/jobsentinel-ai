import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { WorkerLoop } from './scheduler/worker-loop';

/** Worker composition root — no HTTP. Scheduler/pipeline modules are added from Phase 4. */
@Module({
  imports: [ConfigModule],
  providers: [WorkerLoop],
})
export class WorkerModule {}
