import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { assertEnv, type Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { AppError } from '../common/errors/app-error';
import type { TokenVerifier, VerifiedClaims } from './auth.types';

/**
 * Verifies Supabase access tokens offline against the project's JWKS (ES256 keys).
 * jose caches the key set and refreshes it on unknown `kid`, so key rotation needs no restart.
 */
@Injectable()
export class SupabaseJwksVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(@Inject(ENV) env: Env) {
    assertEnv(env, ['SUPABASE_URL', 'SUPABASE_JWT_ISSUER']);
    this.issuer = env.SUPABASE_JWT_ISSUER;
    this.jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  async verify(token: string): Promise<VerifiedClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
        clockTolerance: 30,
      }));
    } catch (err) {
      throw AppError.unauthenticated(
        err instanceof Error ? `Invalid token: ${err.message}` : 'Invalid token',
      );
    }
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const role = typeof payload.role === 'string' ? payload.role : 'authenticated';
    if (!payload.sub || !email) throw AppError.unauthenticated('Token is missing sub/email');
    return { sub: payload.sub, email: email.toLowerCase(), role };
  }
}
