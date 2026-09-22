import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AppError } from '../common/errors/app-error';
import { TOKEN_VERIFIER, type AuthenticatedUser, type TokenVerifier } from './auth.types';
import { UsersBootstrapService } from './users-bootstrap.service';

/** Global guard: verifies the bearer token, bootstraps the user, attaches `request.user`. */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly bootstrap: UsersBootstrapService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw AppError.unauthenticated();

    const claims = await this.verifier.verify(token);
    req.user = await this.bootstrap.ensureUser(claims);
    return true;
  }
}
