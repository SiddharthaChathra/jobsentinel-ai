import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertEnv, MAX_RESUME_BYTES, type Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { AppError } from '../common/errors/app-error';

/** Abstracts private file storage so tests use an in-memory fake (docs 01 §5). */
export interface FileStoragePort {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  signedUrl(path: string, expiresInSec: number, downloadName?: string): Promise<string>;
}
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Supabase Storage, private bucket, service-role client (never exposed to the browser). */
@Injectable()
export class SupabaseStorageAdapter implements FileStoragePort, OnModuleInit {
  private readonly logger = new Logger(SupabaseStorageAdapter.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    assertEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    this.client = createClient<never>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = env.RESUME_BUCKET;
  }

  /** Idempotently ensures the private bucket exists with the size/MIME limits from docs 11. */
  async onModuleInit(): Promise<void> {
    const { data } = await this.client.storage.getBucket(this.bucket);
    if (data) return;
    const { error } = await this.client.storage.createBucket(this.bucket, {
      public: false,
      fileSizeLimit: MAX_RESUME_BYTES,
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    });
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`could not create bucket ${this.bucket}: ${error.message}`);
      return;
    }
    this.logger.log(`created private bucket ${this.bucket}`);
  }

  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, data, { contentType, upsert: true });
    if (error) throw new AppError('STORAGE_UPLOAD_FAILED', `Upload failed: ${error.message}`, 502);
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) this.logger.warn(`remove ${path} failed: ${error.message}`);
  }

  async signedUrl(path: string, expiresInSec: number, downloadName?: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSec, downloadName ? { download: downloadName } : undefined);
    if (error || !data)
      throw new AppError(
        'STORAGE_SIGN_FAILED',
        `Could not sign URL: ${error?.message ?? 'unknown'}`,
        502,
      );
    return data.signedUrl;
  }
}
