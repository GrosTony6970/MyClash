import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The Event's photo mode, and its QR token.
 *
 * The token is never stored. It is HMAC(PHOTO_TOKEN_SECRET, `${eventId}:${version}`), so the public
 * Event read can carry `photo_token_version` without giving the token away, the admin page can show
 * it again for printing, and "New link" (version + 1) retires every printed QR code at once.
 */

export const PHOTO_MODES = ['off', 'live', 'approve'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

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
