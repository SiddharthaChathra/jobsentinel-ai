import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types';

/** Injects the bootstrapped user attached by SupabaseJwtGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) throw new Error('CurrentUser used on a route without SupabaseJwtGuard');
    return req.user;
  },
);
