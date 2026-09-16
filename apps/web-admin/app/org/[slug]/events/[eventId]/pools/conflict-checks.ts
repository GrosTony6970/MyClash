/**
 * The Pools page's fighter/referee conflict checks, one per Tournament.
 *
 * Each answer is kept under the Tournament it was asked for, and an answer older
 * than one already kept for that Tournament is dropped. A check still running
 * when the organiser switches Tournament therefore cannot paint its strip, or
 * clear a warning, under another Tournament.
 *
 * A failed check is kept as a failure (`result: null`), never as an empty
 * answer: an empty strip reads as "no conflicts" (hard rule 8).
 *
 * Pure: no React, no I/O.
 */

export interface ConflictCheck<R> {
  /** The order the check was started in, across the page. */
  seq: number;
  /** The answer, or null when the check failed. */
  result: R | null;
}

export type ConflictChecks<R> = Readonly<Record<string, ConflictCheck<R>>>;

/** Keep an answer under its Tournament, unless a later check there already answered. */
export function recordConflictCheck<R>(
  checks: ConflictChecks<R>,
  tournamentId: string,
  seq: number,
  result: R | null,
): ConflictChecks<R> {
  const kept = checks[tournamentId];
  if (kept && kept.seq > seq) return checks;
  return { ...checks, [tournamentId]: { seq, result } };
}
