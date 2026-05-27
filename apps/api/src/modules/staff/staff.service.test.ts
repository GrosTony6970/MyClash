import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

/**
 * Regression guard for the public match-display endpoint.
 *
 * The original bug: the SELECT string requested a column named
 * `ruleset_config_json` from `tournaments`, but the canonical column
 * (see `packages/db/src/schema/tournaments.ts`) is `ruleset_config`.
 * The PostgREST gateway returned `400 column tournaments_2.ruleset_config_json
 * does not exist`, surfacing as "Could not load scoreboard data (400)"
 * when a referee clicked into a pool match.
 *
 * The behavior we care about: clicking a match must return a payload that
 * exposes the tournament's `matchFormat` (which lives at
 * `tournaments.ruleset_config.matchFormat`). The test mocks Supabase,
 * captures the SELECT string, returns a row with `ruleset_config`
 * populated, and asserts the resulting payload reflects it.
 */
describe('StaffService.getPublicMatchDisplay', () => {
  function makeSupabase(row: Record<string, unknown>) {
    const selectCalls: string[] = [];
    const service = {
      from: vi.fn((_table: string) => {
        const chain = {
          select: vi.fn((sel: string) => {
            selectCalls.push(sel);
            return chain;
          }),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        };
        return chain;
      }),
    };
    return { supabase: { service }, selectCalls };
  }

  it('fetches matchFormat from the canonical ruleset_config column and exposes it on the payload', async () => {
    const matchFormat = { pointCap: 5, doublePenalty: 'none' };
    const row = {
      id: 'match-1',
      status: 'pending',
      red_score: 0,
      blue_score: 0,
      lices: { id: 'lice-1', name: 'L1', events: null },
      red: { id: 'reg-r', persons: { given_name: 'A', family_name: 'X' } },
      blue: { id: 'reg-b', persons: { given_name: 'B', family_name: 'Y' } },
      phases: {
        tournaments: {
          id: 't-1',
          name: 'Open Longsword',
          weapon: 'longsword',
          scoring_config_json: { foo: 'bar' },
          ruleset_config: { matchFormat },
        },
      },
      pools: { sort_order: 0 },
      bracket_slots: null,
    };
    const { supabase, selectCalls } = makeSupabase(row);
    const service = new StaffService(supabase as never, {} as never, {} as never);

    const payload = (await service.getPublicMatchDisplay('match-1')) as { matchFormat: unknown };

    // Behaviour 1: the request asked for the real column name.
    expect(selectCalls.join(' ')).not.toMatch(/ruleset_config_json/);
    expect(selectCalls.join(' ')).toMatch(/ruleset_config/);
    // Behaviour 2: the payload surfaces the matchFormat the caller will read.
    expect(payload.matchFormat).toEqual(matchFormat);
  });
});
