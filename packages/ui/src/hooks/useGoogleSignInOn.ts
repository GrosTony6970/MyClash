'use client';

import { useEffect, useState } from 'react';

/**
 * Whether Google sign-in is switched on, as the sign-in server says (ruling 495).
 *
 * One server setting switches Google on (`GOOGLE_OAUTH_ENABLED`). While it is off, a
 * "Continue with Google" click lands on the sign-in server's bare "provider is not enabled"
 * page. So every Google button asks first and shows on a yes only. The sign-in server answers
 * at `/auth/v1/settings` without a key (`external.google`); Traefik routes `/auth/v1/*`
 * straight to it in production and in dev.
 *
 * A failed read hides the button and says why in the console: email sign-in still works.
 */
export async function googleSignInOn(
  authUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!authUrl) {
    console.warn('Google sign-in hidden: NEXT_PUBLIC_SUPABASE_URL is not set');
    return false;
  }
  try {
    const res = await fetchImpl(`${authUrl}/auth/v1/settings`, { credentials: 'omit' });
    if (!res.ok) throw new Error(`the sign-in server answered ${res.status}`);
    const body = (await res.json()) as { external?: { google?: unknown } } | null;
    return body?.external?.google === true;
  } catch (err) {
    console.warn('Google sign-in hidden: its setting could not be read', err);
    return false;
  }
}

/** `false` until the sign-in server says yes, so the server's HTML never shows the button. */
export function useGoogleSignInOn(authUrl: string | undefined): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let live = true;
    void googleSignInOn(authUrl).then((yes) => {
      if (live) setOn(yes);
    });
    return () => {
      live = false;
    };
  }, [authUrl]);

  return on;
}
