import { currentLegalVersionFields } from '../../src/lib/legal-url';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';

/**
 * The participant login's network layer.
 *
 * Every request answers with a CODE, never a sentence. The copy stays in the
 * component, which is what keeps a literal `t()` key at each call site for the
 * i18n sweep to find — the same split web-admin's `auth-form-state.ts` makes,
 * and for the same reason.
 *
 * Extracted because the page crossed the 400-line file budget. The seam is the
 * one the component already had: each handler was a guard, a fetch, and a
 * mapping from response to message. Only the middle part lives here.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** The `code` field a 4xx body may carry. Absent on most failures. */
async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  return body.code;
}

export type SignInCode = 'ok' | 'email_not_confirmed' | 'failed';

export async function requestPasswordSignIn(
  apiUrl: string,
  email: string,
  password: string,
): Promise<SignInCode> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/public-login`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (res.status === 403 && (await errorCode(res)) === 'email_not_confirmed') {
      return 'email_not_confirmed';
    }
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export type SignUpCode = 'ok' | 'signups_disabled' | 'legal_stale' | 'failed';

export async function requestSignUp(
  apiUrl: string,
  email: string,
  password: string,
): Promise<SignUpCode> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/public-signup`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        email: email.trim(),
        password,
        // Checked server-side against the published registry; a stale pair is
        // refused so a tab open across a policy revision cannot consent to the
        // old text.
        ...currentLegalVersionFields(),
      }),
    });
    if (res.status === 503) return 'signups_disabled';
    if (!res.ok) return (await errorCode(res)) === 'legal_version_stale' ? 'legal_stale' : 'failed';
    return 'ok';
  } catch {
    return 'failed';
  }
}

export async function requestMagicLink(apiUrl: string, email: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: email.trim(), type: 'public_login', redirectTo: '/me' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Request a password-recovery email.
 *
 * Returns nothing, and swallows every failure, on purpose: the endpoint does
 * not enumerate accounts — it answers the same way whether or not the address
 * exists — so the caller must show the same notice either way.
 */
export async function requestPasswordReset(apiUrl: string, email: string): Promise<void> {
  try {
    await fetch(`${apiUrl}/api/v1/auth/public-password-reset`, {
      method: 'POST',
      credentials: 'include',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: email.trim() }),
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Hand off to Google. Resolves `false` when the redirect could not be started;
 * on success the browser is already navigating away.
 */
export async function startGoogleSignIn(origin: string): Promise<boolean> {
  try {
    const next = encodeURIComponent('/me');
    const { error } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/oauth/callback?mode=public_login&next=${next}` },
    });
    return !error;
  } catch {
    return false;
  }
}
