import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The Event's photo QR token. (The photo modes are `@myclash/types`'s `PHOTO_MODES`.)
 *
 * The token is never stored. It is HMAC(PHOTO_TOKEN_SECRET, `${eventId}:${version}`), so the public
 * Event read can carry `photo_token_version` without giving the token away, the admin page can show
 * it again for printing, and "New link" (version + 1) retires every printed QR code at once.
 */

export function photoToken(secret: string, eventId: string, version: number): string {
  return createHmac('sha256', secret).update(`${eventId}:${version}`).digest('base64url');
}

export function photoTokenMatches(
  secret: string,
  eventId: string,
  version: number,
  candidate: unknown,
): boolean {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(photoToken(secret, eventId, version));
  const given = Buffer.from(candidate);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
