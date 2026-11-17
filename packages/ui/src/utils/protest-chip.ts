/**
 * The protest chip's text and its warning, on the pad and on the TV scoreboard:
 * the count alone with no limit, `count/limit` with one, and the warning colour
 * from the limit on. The limit is the Tournament's (`protestRulesOf`).
 */

/** `"2"` with no limit, `"2/2"` with a limit of 2. */
export function protestChipText(count: number, limit: number | null): string {
  return limit === null ? String(count) : `${count}/${limit}`;
}

/** The Fighter reached the limit, or passed it: the chip turns to the warning colour. */
export function protestAtLimit(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}
