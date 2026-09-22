import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobEvents, jobValidation, jobs } from '../common/db/schema';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-error';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ValidationOrchestrator } from './validation.orchestrator';

const IdParam = z.string().uuid();
export const ReviewInput = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  note: z.string().max(500).optional(),
  /** Accepting a company-level doubt can mark the company trusted for future postings. */
  trustCompany: z.boolean().default(false),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

/**
 * Manual review of NEEDS_REVIEW / SUSPICIOUS jobs (docs 08 §5) and forced re-validation.
 * The user is the final authority: the engine only ever proposes.
 */
@Controller('jobs')
export class ValidationController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly orchestrator: ValidationOrchestrator,
  ) {}

  @Post(':id/review')
  @HttpCode(200)
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
    @Body(new ZodValidationPipe(ReviewInput)) body: ReviewInput,
  ): Promise<{ status: string; companyTrusted: boolean }> {
    const job = await this.db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!job) throw AppError.notFound('JOB_NOT_FOUND');
    if (!['NEEDS_REVIEW', 'SUSPICIOUS', 'VALID', 'REJECTED'].includes(job.status)) {
      throw AppError.conflict(
        'JOB_NOT_REVIEWABLE',
        `A job in state ${job.status} cannot be reviewed`,
      );
    }

    const accepted = body.decision === 'ACCEPT';
    const now = new Date();
    let companyTrusted = false;

    await this.db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({
          status: accepted ? 'VALID' : 'REJECTED',
          validationStatus: accepted ? 'VALID' : 'INVALID',
          // Accepting re-opens the re-check cycle; rejecting stops it.
          nextCheckAt: accepted ? new Date(Date.now() + 6 * 3600_000) : null,
          updatedAt: now,
        })
        .where(eq(jobs.id, id));
      await tx
        .update(jobValidation)
        .set({
          status: accepted ? 'VALID' : 'INVALID',
          reviewNote: body.note ?? null,
          reviewedByUserAt: now,
          updatedAt: now,
        })
        .where(eq(jobValidation.jobId, id));
      if (accepted && body.trustCompany) {
        await tx
          .update(companies)
          .set({ isTrusted: true, verifiedAt: null, updatedAt: now })
          .where(eq(companies.id, job.companyId));
        companyTrusted = true;
      }
      if (
        !accepted &&
        body.trustCompany === false &&
        body.decision === 'REJECT' &&
        body.note?.toLowerCase().includes('block company')
      ) {
        await tx
          .update(companies)
          .set({ isBlocked: true, updatedAt: now })
          .where(eq(companies.id, job.companyId));
      }
      await tx.insert(jobEvents).values({
        jobId: id,
        type: 'USER_REVIEWED',
        detail: {
          decision: body.decision,
          note: body.note ?? null,
          trustCompany: companyTrusted,
          userId: user.id,
        },
      });
    });

    return { status: accepted ? 'VALID' : 'REJECTED', companyTrusted };
  }

  @Post(':id/revalidate')
  @HttpCode(202)
  async revalidate(
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<{ status: string }> {
    const job = await this.db.query.jobs.findFirst({
      where: eq(jobs.id, id),
      columns: { id: true },
    });
    if (!job) throw AppError.notFound('JOB_NOT_FOUND');
    const status = await this.orchestrator.revalidate(id);
    return { status };
  }
}
