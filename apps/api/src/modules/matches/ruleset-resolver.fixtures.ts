/**
 * The stored rows of the resolver's tests, split out when its test reached the
 * 400-line cap (ruleset versions slice, the end decision a formula keeps). It
 * imports vitest.
 */
import { vi } from 'vitest';
import { RulesetResolver } from './ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

export const FORMULA = { type: 'var', name: 'victories' };
export const CONSTANTS = {
  pointsPerVictory: 3,
  pointsPerTie: 1,
  pointsPerLoss: 0,
  doublePenalty: 0,
};

/**
 * Mirrors `resolve()`'s two-step query shape rather than using an ordered
 * `mockReturnValueOnce` queue, which desyncs the moment a query is added:
 *
 *   call 1 — resolveFromVersionSnapshot's parent lookup
 *   call 2 — the snapshot row if that parent existed, otherwise the
 *            parent-row fallback's own query
 */
export function makeResolver(rows: { parent?: unknown; snapshot?: unknown; row?: unknown }) {
  let call = 0;
  const selects: string[] = [];
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    let data: unknown;
    if (call === 1) data = rows.parent ?? null;
    else if (rows.parent) data = rows.snapshot ?? null;
    else data = rows.row ?? null;
    const chain = {
      // RECORDS the column list rather than ignoring it. A `mockReturnThis()`
      // select swallows its argument and hands back the whole fixture row, so
      // it will happily "pass" a query that never asked for the column being
      // asserted — which is exactly how the two paths drifted apart.
      select: vi.fn().mockImplementation((columns: string) => {
        selects.push(columns);
        return chain;
      }),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data }),
    };
    return chain;
  });
  return {
    resolver: new RulesetResolver({ service: { from } } as never, createRulesetRegistry()),
    selects,
  };
}
