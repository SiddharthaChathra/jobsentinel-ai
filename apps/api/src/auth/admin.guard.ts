import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import type { AuthenticatedUser } from './auth.types';

/** Use on controllers/handlers that manage sources, companies or system logs. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user?.isAdmin) throw AppError.forbidden('Admin only', 'ADMIN_ONLY');
    return true;
  }
}
