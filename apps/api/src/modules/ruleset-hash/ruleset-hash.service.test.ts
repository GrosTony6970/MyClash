import { describe, expect, it, vi } from 'vitest';
import { RulesetHashService } from './ruleset-hash.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

type TableState = Record<string, { maybeSingle?: unknown }>;

function fakeSupabase(state: TableState) {
  function chain(table: string) {
    const t = state[table] ?? {};
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      is: vi.fn(() => api),
      limit: vi.fn(() => api),
      maybeSingle: vi.fn(() => Promise.resolve({ data: t.maybeSingle ?? null, error: null })),
    };
    return api;
  }
  return { service: { from: vi.fn((table: string) => chain(table)) } };
}

interface Overrides {
  rulesetConfig?: Record<string, unknown>;
  scoringConfig?: Record<string, unknown>;
  penalty?: Record<string, unknown>;
}

// A TF_v1 (registry-coded) tournament with a pinned custom penalty version, so
// resolveRulesetGrammar + resolveScoringStructure both short-circuit to the
// registry and only tournaments + penalty_ruleset_versions are read.
function stateFor(o: Overrides = {}): TableState {
  return {
    tournaments: {
      maybeSingle: {
        id: 't-1',
        event_id: 'e-1',
        ruleset_code: 'TF_v1',
        ruleset_version: '1.0.0',
        ruleset_config: { winBonus: 3, matchFormat: { pointCap: 10 }, ...o.rulesetConfig },
        scoring_config_json: { afterblowMode: 'deductive', ...o.scoringConfig },
        penalty_ruleset_id: 'pr-1',
        penalty_ruleset_version: '1.0.0',
      },
    },
    penalty_ruleset_versions: {
      maybeSingle: {
        accumulation_scope: 'match',
        yellow_card_points: 0,
        red_card_points: -1,
        black_card_points: 0,
        first_black_card_forfeit: 'match',
        second_black_card_forfeit: 'tournament',
        entries: [{ groupNumber: 1, refNumber: 'R1', sanctions: ['yellow', 'red'] }],
        ...o.penalty,
      },
    },
  };
}

const hashOf = (state: TableState) =>
  new RulesetHashService(
    fakeSupabase(state) as never,
    createRulesetRegistry(),
  ).computeTournamentContentHash('t-1');

describe('RulesetHashService.computeTournamentContentHash', () => {
  it('produces a deterministic 64-char sha256 hex', async () => {
    const a = await hashOf(stateFor());
    const b = await hashOf(stateFor());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('changes when the effective scoring config (winBonus) changes', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(stateFor({ rulesetConfig: { winBonus: 5 } }));
    expect(changed).not.toBe(base);
  });

  it('changes when afterblowMode changes (a tournament-level score determinant)', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(stateFor({ scoringConfig: { afterblowMode: 'full' } }));
    expect(changed).not.toBe(base);
  });

  it('changes when the pinned penalty definition changes (cards change scores)', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(stateFor({ penalty: { red_card_points: -3 } }));
    expect(changed).not.toBe(base);
  });

  it('changes when the tournament overrides effective target values', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(
      stateFor({ rulesetConfig: { targets: [{ name: 'deep', value: 3 }] } }),
    );
    expect(changed).not.toBe(base);
  });

  it('changes when tournamentPolicy.forfeitDrawsCount changes (a placing determinant)', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(
      stateFor({ rulesetConfig: { tournamentPolicy: { forfeitDrawsCount: true } } }),
    );
    expect(changed).not.toBe(base);
  });

  it('returns null when the tournament is gone', async () => {
    const supabase = fakeSupabase({ tournaments: { maybeSingle: null } });
    const hash = await new RulesetHashService(
      supabase as never,
      createRulesetRegistry(),
    ).computeTournamentContentHash('x');
    expect(hash).toBeNull();
  });

  it('reports drift when the stored hash is stale', async () => {
    const state = stateFor();
    (state.tournaments!.maybeSingle as Record<string, unknown>).ruleset_content_hash = 'stalehash';
    const drift = await new RulesetHashService(
      fakeSupabase(state) as never,
      createRulesetRegistry(),
    ).describeTournamentDrift('t-1');
    expect(drift.stored).toBe('stalehash');
    expect(drift.current).toMatch(/^[0-9a-f]{64}$/);
    expect(drift.drifted).toBe(true);
  });

  it('reports no drift when the stored hash matches the current', async () => {
    const state = stateFor();
    const current = await new RulesetHashService(
      fakeSupabase(state) as never,
      createRulesetRegistry(),
    ).computeTournamentContentHash('t-1');
    (state.tournaments!.maybeSingle as Record<string, unknown>).ruleset_content_hash = current;
    const drift = await new RulesetHashService(
      fakeSupabase(state) as never,
      createRulesetRegistry(),
    ).describeTournamentDrift('t-1');
    expect(drift.drifted).toBe(false);
  });

  it('falls back to the built-in penalty when nothing is pinned', async () => {
    const state: TableState = {
      tournaments: {
        maybeSingle: {
          id: 't-1',
          event_id: null,
          ruleset_code: 'TF_v1',
          ruleset_version: '1.0.0',
          ruleset_config: { winBonus: 3 },
          scoring_config_json: {},
          penalty_ruleset_id: null,
          penalty_ruleset_version: null,
        },
      },
      // resolveEffectivePenalty → built-in row (by built_in flag).
      penalty_rulesets: {
        maybeSingle: {
          id: 'builtin-1',
          version: '1.0.0',
          accumulation_scope: 'match',
          yellow_card_points: 0,
          red_card_points: -1,
          black_card_points: 0,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
          penalty_ruleset_entries: [{ group_number: 1, ref_number: 'R1', sanctions: ['yellow'] }],
        },
      },
    };
    const hash = await hashOf(state);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
