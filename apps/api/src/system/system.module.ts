import { Module } from '@nestjs/common';
import { AuditLogger } from './audit-logger';
import { HealthController } from './health.controller';
import { StatusService } from './status.service';
import { SystemController } from './system.controller';
import { KeepAwakeService } from './keep-awake.service';

@Module({
  controllers: [HealthController, SystemController],
  providers: [AuditLogger, StatusService, KeepAwakeService],
  exports: [AuditLogger, StatusService],
})
export class SystemModule {}
