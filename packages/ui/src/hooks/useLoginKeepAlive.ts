'use client';

import { useEffect } from 'react';

/**
 * Keeps a display screen's login alive all day (operator rulings 92, 94).
 *
 * A hall screen signed in as a club member shows the bouts the public cannot
 * see. Its access token lives one hour, and the API reads an expired one as a
 * stranger: the hidden bout then answers "not found" and the scoreboard swaps
 * to its error screen. A display page's own reads never renew the login; `/me`
 * does, once it has under five minutes left. Asking every minute therefore
 * replaces the token before it ends.
 *
 * A failed call is dropped on purpose: the next one follows a minute later, and
 * the scoreboard's own freshness cue already shows a screen that lost the API.
 */
export const LOGIN_KEEP_ALIVE_MS = 60_000;

export function startLoginKeepAlive(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
  everyMs: number = LOGIN_KEEP_ALIVE_MS,
): () => void {
  const ask = () => {
    fetchImpl(`${apiBaseUrl}/api/v1/me`, { credentials: 'include', cache: 'no-store' }).catch(
      () => undefined,
    );
  };
  ask();
  const timer = setInterval(ask, everyMs);
  return () => clearInterval(timer);
}

/** Mount on a display route: see `startLoginKeepAlive`. */
export function useLoginKeepAlive(apiBaseUrl: string): void {
  useEffect(() => startLoginKeepAlive(apiBaseUrl), [apiBaseUrl]);
}
