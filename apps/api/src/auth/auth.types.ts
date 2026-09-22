/** Claims we rely on from a verified Supabase access token. */
export interface VerifiedClaims {
  sub: string;
  email: string;
  role: string;
}

/** Abstracts JWT verification so tests can substitute a local signer (docs 13). */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedClaims>;
}
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

/** The application user attached to `request.user` after bootstrap. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  isAdmin: boolean;
  onboardingCompletedAt: Date | null;
  profileVersion: number;
}
