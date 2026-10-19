import { describe, expect, it, vi } from 'vitest';
import { RulesetHashService } from './ruleset-hash.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

type TableState = Record<string, { maybeSingle?: unknown }>;

/** Every column list asked of a table, in order: the doubles answer whatever is asked. */
const selects: Array<{ table: string; columns: string }> = [];

function fakeSupabase(state: TableState) {
  function chain(table: string) {
    const t = state[table] ?? {};
    const api: Record<string, unknown> = {
      select: vi.fn((columns: string) => {
        selects.push({ table, columns });
        return api;
      }),
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
// resolveRulesetGrammar + scoringStructureOf both short-circuit to the
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
  it('describes a Tournament on a draft club ruleset by its own formula (ruling 6)', async () => {
    const onDraft = (scoreFormula: unknown) => ({
      ...stateFor(),
      tournaments: {
        maybeSingle: {
          ...(stateFor().tournaments!.maybeSingle as Record<string, unknown>),
          ruleset_code: 'custom_draft',
        },
      },
      custom_rulesets: {
        maybeSingle: {
          id: 'cr-1',
          is_system: false,
          status: 'draft',
          base_code: null,
          base_version: null,
          score_formula: scoreFormula,
          constants: {},
          tiebreakers: [],
          double_penalty_formula: null,
        },
      },
    });
    const wins = { type: 'var', name: 'victories' };
    const points = { type: 'var', name: 'targetPoints' };
    expect(await hashOf(onDraft(wins))).not.toBe(await hashOf(onDraft(points)));
  });

  it('describes a club formula by the end decision it was published with too (0228)', async () => {
    const formula = { id: 'cr-1', is_system: false, base_code: null, base_version: null };
    const body = {
      score_formula: { type: 'var', name: 'victories' },
      constants: {},
      tiebreakers: [],
    };
    const tournament = {
      ...(stateFor().tournaments!.maybeSingle as Record<string, unknown>),
      ruleset_code: 'custom_club',
    };
    const onRow = (edition: string) => ({
      ...stateFor(),
      tournaments: { maybeSingle: tournament },
      custom_rulesets: { maybeSingle: { ...formula, ...body, decision_edition: edition } },
    });
    const onSnapshot = (edition: string) => ({
      ...onRow('2026-10'),
      custom_ruleset_versions: { maybeSingle: { ...body, decision_edition: edition } },
    });
    selects.length = 0;
    expect(await hashOf(onRow('2026-04'))).not.toBe(await hashOf(onRow('2026-10')));
    expect(await hashOf(onSnapshot('2026-04'))).not.toBe(await hashOf(onSnapshot('2026-10')));
    // The doubles answer whatever is asked: the two reads must ask for the column.
    for (const table of ['custom_rulesets', 'custom_ruleset_versions'])
      expect(
        selects.some(
          (s) => s.table === table && /\bscore_formula\b.*\bdecision_edition\b/.test(s.columns),
        ),
      ).toBe(true);
  });

  it('describes a club formula by its forfeit policy too (ruling "Forfeit")', async () => {
    const clubFormula = {
      maybeSingle: {
        id: 'cr-1',
        is_system: false,
        base_code: null,
        base_version: null,
        score_formula: { type: 'var', name: 'victories' },
        constants: {},
        tiebreakers: [],
        double_penalty_formula: null,
        decision_edition: '2026-10',
      },
    };
    // Two club-formula Tournaments that differ ONLY in their forfeit policy.
    const onPolicy = (forfeitPolicy: unknown) => {
      const state = stateFor({ rulesetConfig: { forfeitPolicy } });
      (state.tournaments!.maybeSingle as Record<string, unknown>).ruleset_code = 'custom_club';
      return { ...state, custom_rulesets: clubFormula };
    };
    const matchOnly = { reasons: { black_card_1: { tournamentState: 'match_only' } } };
    expect(await hashOf(onPolicy(matchOnly))).not.toBe(await hashOf(onPolicy(null)));
  });

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
