/**
 * Winner of a CLOSED round in a best-of-N series, from the engine's own record.
 *
 * Not the same question as who won the match, and not answerable the same way.
 * `matches.winner_registration_id` names the winner of the SERIES and says
 * nothing about a single round; the live red/blue score is no help either,
 * because the round break is exactly the moment before those reset to 0-0 for
 * the next round. The engine appends every closed round to `matches.rounds_json`
 * with the side that took it (`scoring.service.ts`) — that record is the only
 * thing that answers this.
 *
 * This replaced a call to the shared match-winner helper, which compared the
 * two live scores: right by accident most of the time, wrong on a round decided
 * on doubles and about to be wrong on every round of a corrected bout.
 *
 * Null for an unknown round, or one the engine gave no winner (a max-doubles
 * double loss).
 *
 * Pure: no React, no I/O.
 */
export function closedRoundWinner(roundsJson: unknown, round: number): 'red' | 'blue' | null {
  if (!Array.isArray(roundsJson)) return null;
  const entry = roundsJson.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { round?: unknown }).round === round,
  ) as { winnerColor?: unknown } | undefined;
  const winner = entry?.winnerColor;
  return winner === 'red' || winner === 'blue' ? winner : null;
}
