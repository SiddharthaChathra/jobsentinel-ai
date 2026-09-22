import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { MAX_RESUME_BYTES } from '@jobsentinel/config';
import type { Resume, ResumeAnalysis } from '@jobsentinel/types';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-error';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ResumesService } from './resumes.service';

const IdParam = z.string().uuid();
const GetQuery = z.object({ includeText: z.coerce.boolean().default(false) });

@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  /** multipart/form-data with field `file` (PDF/DOCX ≤ 5 MB). 10 uploads/min per user. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Resume> {
    if (!file)
      throw new AppError('FILE_REQUIRED', 'Attach the resume as multipart field "file"', 400);
    return this.resumes.upload(user.id, { originalName: file.originalname, buffer: file.buffer });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Resume[]> {
    return this.resumes.list(user.id);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
    @Query(new ZodValidationPipe(GetQuery)) query: z.infer<typeof GetQuery>,
  ): Promise<Resume> {
    return this.resumes.get(user.id, id, query.includeText);
  }

  @Post(':id/analyze')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  analyze(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<ResumeAnalysis> {
    return this.resumes.analyze(user.id, id);
  }

  @Get(':id/analysis')
  analysis(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<ResumeAnalysis> {
    return this.resumes.getAnalysis(user.id, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<Resume> {
    return this.resumes.activate(user.id, id);
  }

  @Get(':id/download')
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ) {
    return this.resumes.downloadUrl(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(IdParam)) id: string,
  ): Promise<void> {
    await this.resumes.delete(user.id, id);
  }
}
