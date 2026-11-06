// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createOAuthSupabaseClient } from './oauth-supabase';

// A whole Google sign-in, in the order the browser lives it: the login page starts it on
// one client, Google sends the browser back with a code, and the callback page finishes it
// on a NEW client (`src/components/OAuthCallback.tsx`). GoTrue is a stubbed fetch. The same
// test runs in web-public, whose client shares `oauthClientOptions`.
//
// jsdom may lack `crypto.subtle`, in which case auth-js falls back to the `plain` challenge
// method; nothing here depends on which one it picks.

const tokenBodies: unknown[] = [];

function session() {
  return {
    access_token: 'secret-access',
    refresh_token: 'secret-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', app_metadata: {} },
  };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/token?grant_type=pkce')) {
        tokenBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(session()), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const cookieNames = () =>
  document.cookie
    .split('; ')
    .filter(Boolean)
    .map((pair) => pair.slice(0, pair.indexOf('=')));

const cookieValues = () =>
  document.cookie
    .split('; ')
    .filter(Boolean)
    .map((pair) => pair.slice(pair.indexOf('=') + 1));

// `@supabase/ssr` wrote the login as `base64-<base64url JSON>`: read a value as a script would.
function readable(value: string): string {
  const text = decodeURIComponent(value);
  if (!text.startsWith('base64-')) return text;
  return atob(text.slice('base64-'.length).replaceAll('-', '+').replaceAll('_', '/'));
}

const storedValues = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.getItem(localStorage.key(i)!));

test('a google sign-in keeps only the check, and leaves no login behind', async () => {
  const { data } = await createOAuthSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/oauth/callback`,
      skipBrowserRedirect: true,
    },
  });
  const redirectTo = new URL(data.url!).searchParams.get('redirect_to')!;
  expect(redirectTo).toContain('sb_flow_id=');

  window.history.pushState({}, '', `${redirectTo}&code=abc`);
  const beforeReturn = cookieNames();

  const { data: exchanged } = await createOAuthSupabaseClient().auth.exchangeCodeForSession('abc');
  expect(exchanged.session?.access_token).toBe('secret-access');
  expect(tokenBodies.at(-1)).toMatchObject({ auth_code: 'abc', code_verifier: expect.any(String) });
  expect((tokenBodies.at(-1) as { code_verifier: string }).code_verifier).not.toBe('');

  // First the defect: no copy of the login anywhere a page script reads.
  for (const place of [...cookieValues().map(readable), ...storedValues()]) {
    expect(place).not.toContain('secret-access');
    expect(place).not.toContain('secret-refresh');
  }
  // Then the shape: the check lived in a cookie, and nothing is left once it is used.
  expect(cookieNames()).toEqual([]);
  expect(localStorage.length).toBe(0);
  expect(beforeReturn).toContainEqual(expect.stringMatching(/^mc-oauth-flow-.+-code-verifier$/));
});
