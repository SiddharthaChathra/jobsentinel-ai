import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Env } from '@jobsentinel/config';
import { ENV } from '../common/config/config.module';
import { DB, type Db } from '../common/db/db.module';
import { preferences, users } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';
import type { AuthenticatedUser, VerifiedClaims } from './auth.types';

/**
 * First authenticated request creates the app-side `users` + `preferences` rows (idempotent).
 * Sign-up gate: emails outside ALLOWED_SIGNUP_EMAILS get 403 and no rows (docs 11 §2).
 */
@Injectable()
export class UsersBootstrapService {
  private readonly logger = new Logger(UsersBootstrapService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
  ) {}

  isAllowed(email: string): boolean {
    const allow = this.env.ALLOWED_SIGNUP_EMAILS;
    return allow === '*' || allow.includes(email.toLowerCase());
  }

  isAdmin(email: string): boolean {
    const admins = this.env.ADMIN_EMAILS;
    return admins === '*' || admins.includes(email.toLowerCase());
  }

  async ensureUser(claims: VerifiedClaims): Promise<AuthenticatedUser> {
    const existing = await this.db.query.users.findFirst({ where: eq(users.id, claims.sub) });
    if (existing) return toAuthenticated(existing);

    if (!this.isAllowed(claims.email)) {
      this.logger.warn({ email: maskEmail(claims.email) }, 'sign-up rejected by allowlist');
      throw AppError.forbidden('This JobSentinel instance is private.', 'SIGNUP_NOT_ALLOWED');
    }

    const isAdmin = this.isAdmin(claims.email);
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ id: claims.sub, email: claims.email, isAdmin })
        .onConflictDoNothing()
        .returning();
      await tx.insert(preferences).values({ userId: claims.sub }).onConflictDoNothing();
      return row ?? (await tx.query.users.findFirst({ where: eq(users.id, claims.sub) }));
    });
    if (!created) throw new AppError('USER_BOOTSTRAP_FAILED', 'Could not create user', 500);
    this.logger.log({ userId: created.id, isAdmin }, 'user bootstrapped');
    return toAuthenticated(created);
  }
}

function toAuthenticated(row: typeof users.$inferSelect): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.isAdmin,
    onboardingCompletedAt: row.onboardingCompletedAt,
    profileVersion: row.profileVersion,
  };
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
