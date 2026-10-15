import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  classifyAuthFailure,
  requestLinkErrorMessage,
  safeNextPath,
  strayAuthRedirect,
} from './auth-redirect';

const CODE = '3f1c2b6a-9d4e-4f7a-8b2c-1e5d6f7a8b9c';
const site = (path: string) => new URL(path, 'https://jobsentinel-ai.vercel.app');

describe('strayAuthRedirect', () => {
  it('forwards a code that landed on the Site URL root to the callback (D87)', () => {
    const to = strayAuthRedirect(site(`/?code=${CODE}`));
    expect(to?.pathname).toBe('/auth/callback');
    expect(to?.searchParams.get('code')).toBe(CODE);
    expect(to?.searchParams.get('next')).toBe('/dashboard');
  });

  it('keeps the page the link landed on as `next`, and carries Supabase errors', () => {
    const to = strayAuthRedirect(
      site('/jobs?error=access_denied&error_code=otp_expired&error_description=Email+link+expired'),
    );
    expect(to?.pathname).toBe('/auth/callback');
    expect(to?.searchParams.get('error_code')).toBe('otp_expired');
    expect(to?.searchParams.get('next')).toBe('/jobs');
  });

  it('forwards a token_hash link', () => {
    const to = strayAuthRedirect(site('/?token_hash=abc&type=magiclink'));
    expect(to?.searchParams.get('token_hash')).toBe('abc');
    expect(to?.searchParams.get('type')).toBe('magiclink');
  });

  it('leaves ordinary requests and the callback itself alone', () => {
    expect(strayAuthRedirect(site('/dashboard'))).toBeNull();
    expect(strayAuthRedirect(site('/jobs?code=SOFTWARE'))).toBeNull(); // not an auth code
    expect(strayAuthRedirect(site(`/auth/callback?code=${CODE}`))).toBeNull();
    expect(strayAuthRedirect(site('/jobs?error=1'))).toBeNull();
  });

  it('never forwards to an off-site `next`', () => {
    const to = strayAuthRedirect(site(`/?code=${CODE}&next=//evil.example`));
    expect(to?.searchParams.get('next')).toBe('/dashboard');
    expect(to?.origin).toBe('https://jobsentinel-ai.vercel.app');
  });
});

describe('safeNextPath', () => {
  it.each([
    [null, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'], // browsers read `/\` as `//`
    ['/jobs?x=1', '/jobs?x=1'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('classifyAuthFailure', () => {
  it('recognises the failures a user can act on', () => {
    expect(
      classifyAuthFailure({
        code: 'pkce_code_verifier_not_found',
        message: 'PKCE code verifier not found in storage.',
      }),
    ).toBe('different_browser');
    expect(
      classifyAuthFailure({ code: 'otp_expired', message: 'Email link is invalid or has expired' }),
    ).toBe('link_expired');
    expect(classifyAuthFailure({ code: 'flow_state_not_found' })).toBe('link_invalid');
    expect(classifyAuthFailure({ message: 'network down' })).toBe('unknown');
  });

  it('gives every reason, and the legacy generic code, a message', () => {
    for (const r of [
      'link_expired',
      'different_browser',
      'link_invalid',
      'not_allowed',
      'unknown',
    ]) {
      expect(authErrorMessage(r)).toBeTruthy();
    }
    expect(authErrorMessage('auth_callback_failed')).toBeTruthy();
    expect(authErrorMessage(null)).toBeNull();
  });
});

describe('requestLinkErrorMessage', () => {
  it('explains an unknown email instead of echoing Supabase', () => {
    expect(
      requestLinkErrorMessage({ code: 'otp_disabled', message: 'Signups not allowed for otp' }),
    ).toMatch(/No JobSentinel account/);
    expect(requestLinkErrorMessage({ message: 'email rate limit exceeded' })).toMatch(/Too many/);
    expect(requestLinkErrorMessage({ message: 'Something else' })).toBe('Something else');
  });
});
