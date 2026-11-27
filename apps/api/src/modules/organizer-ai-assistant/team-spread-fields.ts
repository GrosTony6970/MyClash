/**
 * The team fields of a `generate_pools` action for a team Tournament. The draw seed goes with
 * `random` only: `teamDrawOf` refuses one with `seed`. A spread the model got wrong (missing, or
 * neither word) is left out, and the Pool door refuses it by name, so the draft fails with a reason.
 */
export function teamSpreadFields(
  spread: unknown,
  seed: number | undefined,
): { teamSpread?: 'seed' | 'random'; seed?: number } {
  if (spread === 'seed') return { teamSpread: 'seed' };
  if (spread === 'random')
    return seed === undefined ? { teamSpread: 'random' } : { teamSpread: 'random', seed };
  return {};
}
