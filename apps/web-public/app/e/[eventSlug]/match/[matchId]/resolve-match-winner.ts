/**
 * Which side won a match, for the public header's 🏆 badge.
 *
 * Prefers the authoritative stored `winnerRegistrationId` (set server-side and
 * correct even for reverse "first-to-zero-loses" rulesets). When it's absent on
 * a completed match (e.g. a time-limit finish, which doesn't persist a winner),
 * falls back to the higher score — the same convention the public pool view
 * already uses. Returns null for non-completed, tie, or double-loss matches.
 *
 * Pure: no React, no I/O.
 */
export function resolveMatchWinner(input: {
  status: string;
  winnerRegistrationId: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
}): 'red' | 'blue' | null {
  if (input.status !== 'completed') return null;
  if (input.winnerRegistrationId === input.redRegistrationId) return 'red';
  if (input.winnerRegistrationId === input.blueRegistrationId) return 'blue';
  if (input.winnerRegistrationId !== null) return null;
  // No stored winner (time-limit / legacy) → higher score wins; tie → none.
  if (input.redScore > input.blueScore) return 'red';
  if (input.blueScore > input.redScore) return 'blue';
  return null;
}
