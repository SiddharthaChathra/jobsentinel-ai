import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module';
import { CompanyVerificationService } from './company-verification.service';
import { UrlProbeService } from './url-probe.service';
import { ValidationController } from './validation.controller';
import { ValidationOrchestrator } from './validation.orchestrator';

@Module({
  imports: [SystemModule],
  controllers: [ValidationController],
  providers: [UrlProbeService, CompanyVerificationService, ValidationOrchestrator],
  exports: [UrlProbeService, CompanyVerificationService, ValidationOrchestrator],
})
export class ValidationModule {}
