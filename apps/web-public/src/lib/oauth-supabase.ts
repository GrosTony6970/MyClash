import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client for the OAuth (PKCE) flow.
 *
 * Uses `@supabase/ssr`'s `createBrowserClient`, which (in a browser, with no
 * explicit `cookies` option) stores the PKCE code verifier and session in
 * cookies via the `document.cookie` API rather than localStorage. Cookies
 * survive the top-level redirect back from the OAuth provider, which the
 * previous `createClient` + localStorage setup did not reliably do — sign-in
 * failed with `AuthPKCECodeVerifierMissingError` when the verifier wasn't
 * found on return.
 *
 * `flowType: 'pkce'` is forced by `@supabase/ssr`. We keep the rest of the
 * original client's behaviour: `detectSessionInUrl: false` so the client does
 * NOT auto-exchange the `?code=` on the callback route (the callback page
 * exchanges it explicitly), and `autoRefreshToken: false` since this client is
 * used only for the one-shot code exchange and is never reused.
 */
export function createOAuthSupabaseClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in the values.',
    );
  }

  return createBrowserClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
