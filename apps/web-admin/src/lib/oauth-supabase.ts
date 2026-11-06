import { oauthClientOptions } from '@myclash/api-client';
import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client for the Google sign-in (PKCE).
 *
 * The login itself goes to our server, which keeps it in httpOnly cookies. This client
 * stores only the one-time check that must survive the trip to Google and back, in a
 * one-hour cookie deleted once used (`oauthClientOptions`, `@myclash/api-client`, shared
 * with web-public). It used to keep the whole login in `localStorage`, with no end date.
 *
 * The callback (`OAuthCallback.tsx`) exchanges the `?code=` itself
 * (`detectSessionInUrl: false`), on a new client built by this function.
 */
export function createOAuthSupabaseClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in the values.',
    );
  }

  return createClient(url, key, oauthClientOptions());
}
