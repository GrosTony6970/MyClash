/**
 * The QR token of the photo link, from the address's `#fragment`
 * (`/e/<slug>/photos/send#<token>`). A browser never sends a fragment, so the token reaches no
 * access log, and Sentry drops every fragment (`sentry-data-collection.ts`).
 *
 * For `useSyncExternalStore`: the server snapshot is `null` (no address there), so the page's
 * Send is disabled in the server's HTML and nothing can be sent before React runs.
 */

/**
 * The token, or `''` when the fragment holds none: only the base64url the API issues
 * (`photo-token.ts`, an HMAC digest) counts. Anything else would be refused anyway, and a
 * character outside Latin-1 cannot even go in a request header (`setRequestHeader` throws).
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

export function readPhotoLinkToken(): string {
  const raw = window.location.hash.replace(/^#/, '').trim();
  return TOKEN_SHAPE.test(raw) ? raw : '';
}

export function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export const NO_TOKEN_ON_THE_SERVER = (): string | null => null;
