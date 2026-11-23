/**
 * When a fighter's bracket ends for them (operator, 2026-11-23): they are busy from the bracket's
 * start until they are eliminated, and to its end while they are still in.
 *
 * Out = a completed bout of theirs in the phase was lost, and nothing of theirs is left to fight
 * there. A loser who fights on (the bronze match, the losers' bracket) is written into that next
 * bout the moment the result is saved (`bracket-advance.service.ts`), so a pending bout is the one
 * sign they are still in. A Tournament with automatic advance switched off waits for the organiser:
 * until then, such a loser reads as out.
 *
 * Pure: the caller hands the fighter's own bouts of ONE bracket phase.
 */

/** Statuses of a bout still to be fought (`match_status_check`, 0001). */
const STILL_TO_FIGHT = new Set(['scheduled', 'running', 'paused']);

export interface BracketBout {
  status: string;
  outcome: 'win' | 'loss' | 'draw' | null;
  scheduledAt: string | null;
  /** The bout's planned length; null when the Event's sheet could not be read. */
  durationMinutes: number | null;
  /** Where the bout ends when it has no length (`next-bout-end.ts`). */
  fallbackEndsAt: string | null;
}

/** The planned end of one bout, in ms; null when neither its length nor a fallback is known. */
function boutEndMs(bout: BracketBout): number | null {
  if (bout.scheduledAt === null) return null;
  const startMs = Date.parse(bout.scheduledAt);
  if (!Number.isFinite(startMs)) return null;
  if (bout.durationMinutes !== null) return startMs + bout.durationMinutes * 60_000;
  const fallback = bout.fallbackEndsAt === null ? NaN : Date.parse(bout.fallbackEndsAt);
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * The end of the bout that put the fighter out, as ISO — null while they are still in, and null
 * when that bout's end is unknown: the caller then keeps the whole bracket, busy rather than free.
 */
export function eliminationEnd(bouts: readonly BracketBout[]): string | null {
  if (bouts.some((bout) => STILL_TO_FIGHT.has(bout.status))) return null;
  const losses = bouts.filter((bout) => bout.status === 'completed' && bout.outcome === 'loss');
  if (losses.length === 0) return null;
  const last = losses.reduce((a, b) =>
    Date.parse(b.scheduledAt ?? '') > Date.parse(a.scheduledAt ?? '') ? b : a,
  );
  const endMs = boutEndMs(last);
  return endMs === null ? null : new Date(endMs).toISOString();
}
