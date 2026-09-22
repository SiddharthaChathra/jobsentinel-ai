import { Module } from '@nestjs/common';
import { AuditLogger } from './audit-logger';
import { HealthController } from './health.controller';
import { StatusService } from './status.service';
import { SystemController } from './system.controller';

@Module({
  controllers: [HealthController, SystemController],
  providers: [AuditLogger, StatusService],
  exports: [AuditLogger, StatusService],
})
export class SystemModule {}
