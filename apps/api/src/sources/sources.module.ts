import { forwardRef, Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SystemModule } from '../system/system.module';
import { SourceManager } from './source-manager';
import { SourceRegistry } from './source-registry';
import { SourcesController } from './sources.controller';

@Module({
  imports: [JobsModule, SystemModule, forwardRef(() => SchedulerModule)],
  controllers: [SourcesController],
  providers: [SourceRegistry, SourceManager],
  exports: [SourceRegistry, SourceManager],
})
export class SourcesModule {}
