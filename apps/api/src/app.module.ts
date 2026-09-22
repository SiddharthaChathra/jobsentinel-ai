import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '@jobsentinel/config';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './common/ai/ai.module';
import { ConfigModule, ENV } from './common/config/config.module';
import { DbModule } from './common/db/db.module';
import { HttpModule } from './common/http/http.module';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { ResumesModule } from './resumes/resumes.module';
import { SourcesModule } from './sources/sources.module';
import { SystemModule } from './system/system.module';
import { UsersModule } from './users/users.module';

/** HTTP API composition root (docs 05 §1). Feature modules are added phase by phase. */
@Module({
  imports: [
    ConfigModule,
    DbModule,
    HttpModule,
    AiModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MIN }],
      }),
    }),
    AuthModule,
    SystemModule,
    UsersModule,
    ResumesModule,
    SourcesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*path');
  }
}
