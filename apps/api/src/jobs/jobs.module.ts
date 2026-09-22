import { Module } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { CompaniesService } from './companies.service';
import { DedupeService } from './dedupe.service';
import { JobEventsService } from './job-events.service';

/** Canonical jobs, companies, dedupe and audit events. Controllers arrive in Phase 8. */
@Module({
  providers: [CompaniesService, DedupeService, JobEventsService, ClassificationService],
  exports: [CompaniesService, DedupeService, JobEventsService, ClassificationService],
})
export class JobsModule {}
