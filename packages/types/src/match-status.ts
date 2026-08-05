/**
 * match-status.ts — what a `matches.status` value MEANS, in one place.
 *
 * The DB CHECK constraint (0001_init.sql) allows five values:
 * `scheduled | running | paused | completed | voided`. The string is
 * cheap to compare and that is exactly the problem: every surface that
 * wanted "is this piste fighting right now" wrote its own comparison,
 * and they did not agree.
 *
 * Three of them read `status === 'running'` and dropped a paused bout
 * off the screen mid-fight — a referee pausing for a doctor call made
 * the piste go dark on the spectator board. A fourth inferred liveness
 * from "the payload has a current match", which put merely SCHEDULED
 * bouts under a LIVE banner (see staff.service.ts getCurrentForLiceId).
 *
 * So the predicate lives here, in the dependency-free types package,
 * where the API, the pad, the public site and the admin can all reach
 * the same answer.
 */

/** `matches.status` — the five values the DB CHECK constraint allows. */
export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

/**
 * Whether a match status means "happening on the piste right now".
 *
 * PAUSED IS LIVE. A paused bout still owns its piste, its referees and
 * its clock — the fighters are standing on the strip waiting to resume.
 * Treating it as not-live is what made pistes vanish from the boards
 * every time a referee called a halt.
 *
 * Deliberately takes a loose `string | null | undefined`: most callers
 * hold a status that came off a JSON payload as a bare string.
 */
export function isLiveStatus(status: string | null | undefined): boolean {
  return status === 'running' || status === 'paused';
}
