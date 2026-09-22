import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  type AIService,
  buildResumeProfileRequest,
  RESUME_PROFILE_PROMPT_VERSION,
} from '@jobsentinel/ai';
import { MAX_RESUME_BYTES } from '@jobsentinel/config';
import { ResumeProfileDraft, type Resume, type ResumeAnalysis } from '@jobsentinel/types';
import { extractGraduationYear, extractSkills } from '@jobsentinel/validation';
import { AI_SERVICE } from '../common/ai/ai.module';
import { DB, type Db } from '../common/db/db.module';
import { resumes } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import { parseResume, redactForAi, sniffResumeMime } from './parsers';
import { FILE_STORAGE, type FileStoragePort } from './storage';

export interface UploadInput {
  originalName: string;
  buffer: Buffer;
}

const MAX_RESUMES_PER_USER = 10;

/** Upload → private storage → text extraction → AI draft → activate (docs 01 §4.1, 09 §3). */
@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(AI_SERVICE) private readonly ai: AIService | null,
  ) {}

  async upload(userId: string, input: UploadInput): Promise<Resume> {
    if (input.buffer.length === 0)
      throw AppError.unprocessable('EMPTY_FILE', 'The uploaded file is empty');
    if (input.buffer.length > MAX_RESUME_BYTES)
      throw new AppError('FILE_TOO_LARGE', 'Resume must be 5 MB or smaller', 413);
    const mime = sniffResumeMime(input.buffer);
    if (!mime)
      throw new AppError('UNSUPPORTED_FILE_TYPE', 'Only PDF and DOCX resumes are accepted', 415);

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const duplicate = await this.db.query.resumes.findFirst({
      where: and(eq(resumes.userId, userId), eq(resumes.sha256, sha256)),
    });
    if (duplicate) return toResume(duplicate);

    const count = await this.db.$count(resumes, eq(resumes.userId, userId));
    if (count >= MAX_RESUMES_PER_USER)
      throw AppError.conflict(
        'TOO_MANY_RESUMES',
        `Delete an old resume first (limit ${MAX_RESUMES_PER_USER})`,
      );

    // Parse before storing so a broken file never leaves a dangling object.
    const parsed = await parseResume(input.buffer, mime);
    const fileName = sanitizeFileName(input.originalName, mime);
    const [row] = await this.db
      .insert(resumes)
      .values({
        userId,
        storagePath: 'pending',
        fileName,
        mimeType: mime,
        sizeBytes: input.buffer.length,
        sha256,
        parseStatus: 'UPLOADED',
      })
      .returning();
    if (!row) throw new AppError('RESUME_SAVE_FAILED', 'Could not save resume', 500);

    const storagePath = `${userId}/${row.id}${mime === 'application/pdf' ? '.pdf' : '.docx'}`;
    try {
      await this.storage.put(storagePath, input.buffer, mime);
    } catch (err) {
      await this.db.delete(resumes).where(eq(resumes.id, row.id));
      throw err;
    }
    const [updated] = await this.db
      .update(resumes)
      .set({
        storagePath,
        extractedText: parsed.text,
        parseStatus: 'PARSED',
        parsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(resumes.id, row.id))
      .returning();
    this.logger.log(
      { userId, resumeId: row.id, mime, pages: parsed.pages, chars: parsed.text.length },
      'resume uploaded and parsed',
    );
    return toResume(updated ?? row);
  }

  async list(userId: string): Promise<Resume[]> {
    const rows = await this.db.query.resumes.findMany({
      where: eq(resumes.userId, userId),
      orderBy: [desc(resumes.uploadedAt)],
    });
    return rows.map((r) => toResume(r));
  }

  async get(userId: string, id: string, includeText = false): Promise<Resume> {
    const row = await this.getRow(userId, id);
    return toResume(row, includeText);
  }

  /**
   * AI analysis with a deterministic fallback: if no provider is configured or the call fails,
   * a draft is built from the skill dictionary + regex so onboarding can still complete.
   */
  async analyze(userId: string, id: string): Promise<ResumeAnalysis> {
    const row = await this.getRow(userId, id);
    if (!row.extractedText)
      throw AppError.unprocessable('RESUME_NOT_PARSED', 'Resume text is not available');

    let draft: ResumeProfileDraft;
    let provider = 'deterministic';
    let model = 'skills-dictionary';
    let deterministicFallback = true;

    if (this.ai) {
      const result = await this.ai.run(
        buildResumeProfileRequest({ resumeText: redactForAi(row.extractedText) }),
      );
      if (result.status === 'OK') {
        draft = mergeWithDeterministic(result.data, row.extractedText);
        provider = result.provider;
        model = result.model;
        deterministicFallback = false;
      } else {
        this.logger.warn(
          { resumeId: id, status: result.status, error: result.error },
          'ai resume analysis failed; using deterministic draft',
        );
        draft = deterministicDraft(row.extractedText);
      }
    } else {
      draft = deterministicDraft(row.extractedText);
    }

    const analyzedAt = new Date();
    await this.db
      .update(resumes)
      .set({
        aiAnalysis: draft,
        aiProvider: provider,
        aiModel: model,
        promptVersion: RESUME_PROFILE_PROMPT_VERSION,
        parseStatus: 'ANALYZED',
        analyzedAt,
        updatedAt: analyzedAt,
      })
      .where(eq(resumes.id, id));
    return {
      resumeId: id,
      draft,
      provider,
      model,
      promptVersion: RESUME_PROFILE_PROMPT_VERSION,
      deterministicFallback,
      analyzedAt: analyzedAt.toISOString(),
    };
  }

  async getAnalysis(userId: string, id: string): Promise<ResumeAnalysis> {
    const row = await this.getRow(userId, id);
    const parsed = ResumeProfileDraft.safeParse(row.aiAnalysis);
    if (!row.aiAnalysis || !parsed.success || !row.analyzedAt)
      throw AppError.notFound('ANALYSIS_NOT_FOUND', 'Run analysis first');
    return {
      resumeId: id,
      draft: parsed.data,
      provider: row.aiProvider ?? 'unknown',
      model: row.aiModel ?? 'unknown',
      promptVersion: row.promptVersion ?? RESUME_PROFILE_PROMPT_VERSION,
      deterministicFallback: row.aiProvider === 'deterministic',
      analyzedAt: row.analyzedAt.toISOString(),
    };
  }

  async activate(userId: string, id: string): Promise<Resume> {
    await this.getRow(userId, id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(resumes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(resumes.userId, userId), eq(resumes.isActive, true)));
      await tx
        .update(resumes)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(resumes.id, id));
    });
    return this.get(userId, id);
  }

  async downloadUrl(userId: string, id: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.getRow(userId, id);
    const url = await this.storage.signedUrl(row.storagePath, 60, row.fileName);
    return { url, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.getRow(userId, id);
    await this.db.delete(resumes).where(eq(resumes.id, id));
    await this.storage.remove(row.storagePath);
  }

  private async getRow(userId: string, id: string): Promise<typeof resumes.$inferSelect> {
    const row = await this.db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    });
    if (!row) throw AppError.notFound('RESUME_NOT_FOUND');
    return row;
  }
}

/** Skills the dictionary finds but the AI missed are appended — the user prunes them on review. */
function mergeWithDeterministic(draft: ResumeProfileDraft, text: string): ResumeProfileDraft {
  const have = new Set(draft.skills.map((s) => s.name.toLowerCase()));
  const extra = extractSkills(text)
    .filter((s) => !have.has(s.name.toLowerCase()))
    .map((s) => ({ name: s.name, category: s.category, proficiency: null }));
  return {
    ...draft,
    skills: [...draft.skills, ...extra].slice(0, 60),
    graduationYear: draft.graduationYear ?? extractGraduationYear(text),
  };
}

export function deterministicDraft(text: string): ResumeProfileDraft {
  return ResumeProfileDraft.parse({
    skills: extractSkills(text).map((s) => ({
      name: s.name,
      category: s.category,
      proficiency: null,
    })),
    graduationYear: extractGraduationYear(text),
    experienceLevel: 'FRESHER',
    summary: null,
  });
}

function sanitizeFileName(name: string, mime: string): string {
  const base = name
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const ext = mime === 'application/pdf' ? '.pdf' : '.docx';
  return base.toLowerCase().endsWith(ext) ? base : `${base || 'resume'}${ext}`;
}

function toResume(row: typeof resumes.$inferSelect, includeText = false): Resume {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    parseStatus: row.parseStatus,
    isActive: row.isActive,
    hasAnalysis: row.aiAnalysis !== null,
    aiProvider: row.aiProvider,
    aiModel: row.aiModel,
    errorMessage: row.errorMessage,
    uploadedAt: row.uploadedAt.toISOString(),
    parsedAt: row.parsedAt?.toISOString() ?? null,
    analyzedAt: row.analyzedAt?.toISOString() ?? null,
    ...(includeText && row.extractedText ? { extractedText: row.extractedText } : {}),
  };
}
