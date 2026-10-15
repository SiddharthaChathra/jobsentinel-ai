import { z } from 'zod';

/** `POST /auth/signup-check` (docs 03 §2) — the only public route besides `/health*`. */
export const SignupCheckInput = z.object({
  email: z.email().max(254),
});
export type SignupCheckInput = z.infer<typeof SignupCheckInput>;

export interface SignupCheckResult {
  /** Whether this email may create an account on this instance (ALLOWED_SIGNUP_EMAILS). */
  allowed: boolean;
}
