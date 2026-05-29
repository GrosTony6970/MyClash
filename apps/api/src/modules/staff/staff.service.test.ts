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

  // External-display redesign: the payload now needs to expose the
  // pool name, fighter position within the pool (Fight 3 / 16),
  // and per-fighter club name + logo so the spectator display can
  // render the redesigned header without a follow-up call.
  describe('display redesign payload extensions', () => {
    function makeExtendedSupabase(
      mainRow: Record<string, unknown>,
      poolMatches: Array<{ id: string; match_number_label: string | null }>,
    ) {
      let call = 0;
      const service = {
        from: vi.fn((_table: string) => {
          call += 1;
          if (call === 1) {
            // Main match select
            const chain: Record<string, unknown> = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mainRow, error: null }),
            };
            return chain;
          }
          // Sibling-matches select for fight index / total
          const promise = Promise.resolve({ data: poolMatches, error: null });
          const chain = Object.assign(promise, {
            select: vi.fn(),
            eq: vi.fn(),
            order: vi.fn(),
          });
          for (const k of ['select', 'eq', 'order']) {
            (chain as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
          }
          return chain;
        }),
      };
      return { supabase: { service } };
    }

    it('returns poolName + fightIndex + totalFightsInPool, and resolves club info per side', async () => {
      const row = {
        id: 'match-3',
        status: 'running',
        red_score: 4,
        blue_score: 2,
        red_registration_id: 'reg-r',
        blue_registration_id: 'reg-b',
        match_number_label: 'L1-PA-M3',
        pool_id: 'pool-1',
        lices: { id: 'lice-1', name: 'Lice 1', events: null },
        pools: { id: 'pool-1', name: 'Pool A', sort_order: 0 },
        red: {
          id: 'reg-r',
          persons: {
            id: 'p-r',
            given_name: 'Anthony',
            family_name: 'Garnier',
            club_id: 'club-lyon',
            clubs: { name: 'Lyon AMHE', logo_url: 'https://cdn.example/lyon.png' },
            global_person_id: null,
            global_persons: null,
          },
        },
        blue: {
          id: 'reg-b',
          persons: {
            id: 'p-b',
            given_name: 'Aleksandr',
            family_name: 'Ermolov',
            // Direct club null — should fall back to global_persons.club_id
            club_id: null,
            clubs: null,
            global_person_id: 'gp-b',
            global_persons: {
              club_id: 'club-lyon',
              clubs: { name: 'Lyon AMHE', logo_url: null },
            },
          },
        },
        phases: {
          tournaments: {
            id: 't-1',
            name: 'Longsword Open',
            weapon: 'longsword',
            scoring_config_json: null,
            ruleset_config: null,
          },
        },
        bracket_slots: null,
      };
      // 16 sibling matches in the same pool; match-3 sits at index 2
      // (zero-based) → fightIndex = 3, totalFightsInPool = 16.
      const poolMatches = Array.from({ length: 16 }, (_, i) => ({
        id: i === 2 ? 'match-3' : `match-${i + 1}`,
        match_number_label: `L1-PA-M${i + 1}`,
      }));

      const { supabase } = makeExtendedSupabase(row, poolMatches);
      const service = new StaffService(supabase as never, {} as never, {} as never);

      const payload = (await service.getPublicMatchDisplay('match-3')) as Record<string, unknown>;

      expect(payload['poolName']).toBe('Pool A');
      expect(payload['fightIndex']).toBe(3);
      expect(payload['totalFightsInPool']).toBe(16);
      expect(payload['redClub']).toEqual({
        name: 'Lyon AMHE',
        logoUrl: 'https://cdn.example/lyon.png',
      });
      expect(payload['blueClub']).toEqual({
        name: 'Lyon AMHE',
        logoUrl: null,
      });
    });

    it('returns null pool fields for bracket matches (no pool_id)', async () => {
      const row = {
        id: 'bracket-1',
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
        red_registration_id: 'reg-r',
        blue_registration_id: 'reg-b',
        match_number_label: '1',
        pool_id: null,
        lices: { id: 'lice-1', name: 'Lice 1', events: null },
        pools: null,
        red: {
          id: 'reg-r',
          persons: {
            id: 'p-r',
            given_name: 'A',
            family_name: 'X',
            club_id: null,
            clubs: null,
            global_person_id: null,
            global_persons: null,
          },
        },
        blue: {
          id: 'reg-b',
          persons: {
            id: 'p-b',
            given_name: 'B',
            family_name: 'Y',
            club_id: null,
            clubs: null,
            global_person_id: null,
            global_persons: null,
          },
        },
        phases: {
          tournaments: {
            id: 't-1',
            name: 'Longsword Open',
            weapon: 'longsword',
            scoring_config_json: null,
            ruleset_config: null,
          },
        },
        bracket_slots: { round: 4 },
      };
      const { supabase } = makeExtendedSupabase(row, []);
      const service = new StaffService(supabase as never, {} as never, {} as never);

      const payload = (await service.getPublicMatchDisplay('bracket-1')) as Record<string, unknown>;

      expect(payload['poolName']).toBeNull();
      expect(payload['fightIndex']).toBeNull();
      expect(payload['totalFightsInPool']).toBeNull();
      expect(payload['redClub']).toBeNull();
      expect(payload['blueClub']).toBeNull();
    });
  });
});
