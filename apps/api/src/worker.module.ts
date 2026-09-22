import { Module } from '@nestjs/common';
import { AiModule } from './common/ai/ai.module';
import { ConfigModule } from './common/config/config.module';
import { DbModule } from './common/db/db.module';
import { HttpModule } from './common/http/http.module';
import { SchedulerModule } from './scheduler/scheduler.module';

/** Worker composition root — no HTTP server, no auth (docs 05 §1). */
@Module({
  imports: [ConfigModule, DbModule, HttpModule, AiModule, SchedulerModule],
})
export class WorkerModule {}
