import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { DedupeService } from './dedupe.service';
import { JobEventsService } from './job-events.service';

/** Canonical jobs, companies, dedupe and audit events. Controllers arrive in Phase 8. */
@Module({
  providers: [CompaniesService, DedupeService, JobEventsService],
  exports: [CompaniesService, DedupeService, JobEventsService],
})
export class JobsModule {}
