import { createHash, randomBytes } from 'node:crypto';

/**
 * The event pass secret — minting and hashing, with no Nest and no Supabase.
 *
 * Split out so the one property that actually matters (the raw value never
 * equals the stored value) is unit-testable without a query-builder double.
 * Mirrors the helpers in `auth.service.ts` and `person-email-change.service.ts`,
 * which solved this twice already; this is the third caller and therefore the
 * moment it stops being copied.
 */

/**
 * 32 bytes. base64url so the QR encodes 43 alphanumeric characters in
 * alphanumeric mode rather than falling back to byte mode — a materially less
 * dense symbol, which is the difference between a clean read and three attempts
 * on a borrowed tablet in bad light.
 */
const PASS_TOKEN_BYTES = 32;

export function mintPassToken(): string {
  return randomBytes(PASS_TOKEN_BYTES).toString('base64url');
}

/**
 * What goes in `event_passes.token_hash`.
 *
 * A bare digest, no salt and no constant-time compare — the same reasoning the
 * two existing implementations record: the token is 256 bits of entropy, so
 * there is nothing to brute-force and nothing to rainbow-table, and the match is
 * an indexed equality inside Postgres rather than a comparison in this process.
 */
export function hashPassToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * A pass token as it may arrive from a scanner.
 *
 * The decoder hands back whatever the symbol contained. Anything that is not
 * plausibly one of our tokens is rejected here rather than becoming a database
 * round trip: a desk pointed at a poster, a shipping label or a wifi QR would
 * otherwise fire a query per frame.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

export function looksLikePassToken(value: string): boolean {
  return TOKEN_SHAPE.test(value.trim());
}

/**
 * When a pass issued now should stop working.
 *
 * Event end + 7 days, the same window a guest session gets (`guest-sessions.
 * controller.ts`), because they answer the same question: how long after the
 * doors close is this device still legitimately holding an event identity.
 *
 * Null when the event has no end date. A draft or a club night often has none,
 * and inventing one would expire a pass the organiser never dated.
 */
const PASS_GRACE_DAYS = 7;

export function passExpiryFor(eventEndDate: string | null): string | null {
  if (!eventEndDate) return null;
  const end = new Date(eventEndDate);
  if (Number.isNaN(end.getTime())) return null;
  return new Date(end.getTime() + PASS_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
