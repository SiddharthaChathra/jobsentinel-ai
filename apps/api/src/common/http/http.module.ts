import { Global, Module } from '@nestjs/common';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../config/config.module';
import { HttpClient, type HttpClientPort } from './http-client';

export const HTTP_CLIENT = Symbol('HTTP_CLIENT');

/** One shared outbound client (per-host politeness state lives in it). */
@Global()
@Module({
  providers: [
    {
      provide: HTTP_CLIENT,
      useFactory: (env: Env): HttpClientPort =>
        new HttpClient({
          userAgent: env.HTTP_USER_AGENT,
          defaultTimeoutMs: env.HTTP_TIMEOUT_MS,
          politenessMs: 1000,
        }),
      inject: [ENV],
    },
  ],
  exports: [HTTP_CLIENT],
})
export class HttpModule {}
