/**
 * Which side won a pool match, or null. Only a completed match with a strict
 * score differential elects a winner — ties (and unfinished matches) have none.
 * Mirrors the admin MatchesTab winner-bold rule so the two tables agree.
 */
export function poolMatchWinner(m: {
  status: string;
  redScore: number | null;
  blueScore: number | null;
}): 'red' | 'blue' | null {
  if (m.status !== 'completed') return null;
  const red = m.redScore ?? 0;
  const blue = m.blueScore ?? 0;
  if (red > blue) return 'red';
  if (blue > red) return 'blue';
  return null;
}
