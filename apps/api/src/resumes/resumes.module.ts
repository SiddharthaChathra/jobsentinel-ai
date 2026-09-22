import { Module } from '@nestjs/common';
import { ResumesController } from './resumes.controller';
import { ResumesService } from './resumes.service';
import { FILE_STORAGE, SupabaseStorageAdapter } from './storage';

@Module({
  controllers: [ResumesController],
  providers: [ResumesService, { provide: FILE_STORAGE, useClass: SupabaseStorageAdapter }],
  exports: [ResumesService],
})
export class ResumesModule {}
