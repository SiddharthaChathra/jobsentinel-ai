import { z } from 'zod';
import { ResumeParseStatus } from '../enums';
import { ResumeProfileDraft } from './profile';

export const Resume = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  parseStatus: ResumeParseStatus,
  isActive: z.boolean(),
  hasAnalysis: z.boolean(),
  aiProvider: z.string().nullable(),
  aiModel: z.string().nullable(),
  errorMessage: z.string().nullable(),
  uploadedAt: z.string(),
  parsedAt: z.string().nullable(),
  analyzedAt: z.string().nullable(),
  /** Only when `?includeText=true` and the caller owns the resume. */
  extractedText: z.string().optional(),
});
export type Resume = z.infer<typeof Resume>;

export const ResumeAnalysis = z.object({
  resumeId: z.string().uuid(),
  draft: ResumeProfileDraft,
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  /** True when AI was unavailable and the draft came from deterministic extraction only. */
  deterministicFallback: z.boolean(),
  analyzedAt: z.string(),
});
export type ResumeAnalysis = z.infer<typeof ResumeAnalysis>;

export const ALLOWED_RESUME_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
