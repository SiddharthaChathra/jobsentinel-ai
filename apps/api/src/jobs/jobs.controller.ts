import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApplicationUpsert,
  ApplicationsQuery,
  JobsQuery,
  NotInterestedInput,
  SavedJobsQuery,
  type ApplicationItem,
  type DashboardSummary,
  type JobCard,
  type JobDetail,
  type JobEventItem,
  type TrackerState,
  ReviewJobCard,
} from '@jobsentinel/types';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { enveloped } from '../common/interceptors/envelope.interceptor';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { TrackerService } from './tracker.service';

/**
 * Jobs, tracker and dashboard reads (docs 03 §3–§5).
 *
 * `POST /jobs/:id/review` and `/revalidate` live in `ValidationController`, which owns the
 * validation state machine.
 */
@Controller()
export class JobsController {
  constructor(
    private readonly query: JobsQueryService,
    private readonly detail: JobsDetailService,
    private readonly tracker: TrackerService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('jobs')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(JobsQuery)) query: JobsQuery,
  ) {
    const { items, nextCursor } = await this.query.list(user.id, query);
    return enveloped<JobCard[]>(items, { nextCursor });
  }

  /**
   * The Needs review view (C step 2, D106): held jobs with why they are held. Same filters and
   * gates as `/jobs` (location, fresher "0 to any", 60 days, open), never in the main list, never
   * sent to Telegram. Declared before `jobs/:id` so the path is not taken for an id.
   */
  @Get('jobs/needs-review')
  async needsReview(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(JobsQuery)) query: JobsQuery,
  ) {
    const { items, nextCursor } = await this.query.list(user.id, query, undefined, {
      review: true,
    });
    const held = await this.query.heldReasons(items.map((j) => j.id));
    const cards: ReviewJobCard[] = items.map((j) => ({
      ...j,
      held: held.get(j.id) ?? { kind: 'OTHER', label: 'Held for review', reason: '' },
    }));
    return enveloped<ReviewJobCard[]>(cards, { nextCursor });
  }

  @Get('jobs/:id')
  job(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobDetail> {
    return this.detail.detail(user.id, id);
  }

  @Get('jobs/:id/events')
  events(@Param('id', ParseUUIDPipe) id: string): Promise<JobEventItem[]> {
    return this.detail.events(id);
  }

  @Post('jobs/:id/view')
  @HttpCode(200)
  view(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackerState> {
    return this.detail.markViewed(user.id, id);
  }

  @Post('jobs/:id/save')
  @HttpCode(200)
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackerState> {
    return this.detail.setSaved(user.id, id, true);
  }

  @Delete('jobs/:id/save')
  @HttpCode(200)
  unsave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackerState> {
    return this.detail.setSaved(user.id, id, false);
  }

  @Post('jobs/:id/not-interested')
  @HttpCode(200)
  notInterested(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(NotInterestedInput)) body: NotInterestedInput,
  ): Promise<TrackerState> {
    return this.detail.notInterested(user.id, id, body.reason);
  }

  @Get('saved-jobs')
  async savedJobs(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(SavedJobsQuery)) query: SavedJobsQuery,
  ) {
    const { items, nextCursor } = await this.tracker.saved(user.id, query);
    return enveloped<JobCard[]>(items, { nextCursor });
  }

  @Get('applications')
  async applications(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(ApplicationsQuery)) query: ApplicationsQuery,
  ) {
    const { items, nextCursor } = await this.tracker.applications(user.id, query);
    return enveloped<ApplicationItem[]>(items, { nextCursor });
  }

  @Put('applications/:jobId')
  upsertApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(ApplicationUpsert)) body: ApplicationUpsert,
  ): Promise<ApplicationItem> {
    return this.tracker.upsert(user.id, jobId, body);
  }

  @Delete('applications/:jobId')
  @HttpCode(204)
  async removeApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<void> {
    await this.tracker.remove(user.id, jobId);
  }

  @Get('dashboard/summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<DashboardSummary> {
    return this.dashboard.summary(user.id, user.profileVersion);
  }
}
