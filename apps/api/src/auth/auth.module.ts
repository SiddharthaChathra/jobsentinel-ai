import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminGuard } from './admin.guard';
import { TOKEN_VERIFIER } from './auth.types';
import { SupabaseJwksVerifier } from './supabase-jwks.verifier';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { UsersBootstrapService } from './users-bootstrap.service';

/** Authentication for the HTTP API. The worker never imports this module. */
@Global()
@Module({
  providers: [
    { provide: TOKEN_VERIFIER, useClass: SupabaseJwksVerifier },
    UsersBootstrapService,
    AdminGuard,
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
  ],
  exports: [TOKEN_VERIFIER, UsersBootstrapService, AdminGuard],
})
export class AuthModule {}
