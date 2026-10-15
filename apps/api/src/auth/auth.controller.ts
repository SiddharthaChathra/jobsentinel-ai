import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignupCheckInput, type SignupCheckResult } from '@jobsentinel/types';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UsersBootstrapService } from './users-bootstrap.service';

/**
 * Public pre-check for the sign-up page (docs 03 §2, D91).
 *
 * The allow-list is enforced on every authenticated request regardless (UsersBootstrapService);
 * this only lets the page refuse *before* Supabase creates an account and sends a confirmation
 * email that would end on "this instance is private". It reveals whether one email may sign up,
 * so it is throttled well below the global limit.
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersBootstrapService) {}

  @Post('signup-check')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  signupCheck(
    @Body(new ZodValidationPipe(SignupCheckInput)) body: SignupCheckInput,
  ): SignupCheckResult {
    return { allowed: this.users.isAllowed(body.email) };
  }
}
