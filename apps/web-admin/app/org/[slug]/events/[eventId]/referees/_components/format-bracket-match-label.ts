/**
 * Map a bracket match's (round, position, maxRound) triple to a human
 * label like 'Quarter-final #2' instead of the raw 'R1P2'. Pure: the
 * caller passes in a `t` function so the helper itself stays vitest-
 * friendly. Unknown / deeper rounds fall back to the raw R{N} #{P} so an
 * untranslated tier shows up clearly in QA rather than going silent.
 */
const BASE_KEY = 'organizer.bracketPage.rounds';

export function formatBracketMatchLabel(
  round: number,
  position: number,
  maxRound: number,
  t: (key: string) => string,
): string {
  if (maxRound <= 0) {
    return `R${round} #${position}`;
  }
  if (round === maxRound) {
    return position === 1 ? t(`${BASE_KEY}.final`) : t(`${BASE_KEY}.bronze`);
  }
  const tierKey = (() => {
    if (round === maxRound - 1) return 'semi';
    if (round === maxRound - 2) return 'qf';
    if (round === maxRound - 3) return 'r16';
    if (round === maxRound - 4) return 'r32';
    return null;
  })();
  if (tierKey) {
    return `${t(`${BASE_KEY}.${tierKey}`)} #${position}`;
  }
  return `R${round} #${position}`;
}
