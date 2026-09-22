import { Module } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { CompaniesService } from './companies.service';
import { DashboardService } from './dashboard.service';
import { DedupeService } from './dedupe.service';
import { JobEventsService } from './job-events.service';
import { JobsController } from './jobs.controller';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { TrackerService } from './tracker.service';

/**
 * Canonical jobs, companies, dedupe and audit events, plus the read/tracker API (docs 03 §3–§5).
 * The controller is only mounted by the API process; the worker imports this module for the
 * pipeline services and simply never routes HTTP.
 */
@Module({
  controllers: [JobsController],
  providers: [
    CompaniesService,
    DedupeService,
    JobEventsService,
    ClassificationService,
    JobsQueryService,
    JobsDetailService,
    TrackerService,
    DashboardService,
  ],
  exports: [
    CompaniesService,
    DedupeService,
    JobEventsService,
    ClassificationService,
    JobsQueryService,
    JobsDetailService,
    TrackerService,
  ],
})
export class JobsModule {}
