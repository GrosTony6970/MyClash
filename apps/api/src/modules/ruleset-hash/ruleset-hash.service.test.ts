import { describe, expect, it, vi } from 'vitest';
import { RulesetHashService } from './ruleset-hash.service';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
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
  /** The Tournament's own changes of its forfeit rules (`tournaments.forfeit_rules`). */
  forfeitChanges?: Record<string, unknown> | null;
}

/** The LIVE penalty row a pin reads: what the engine scores cards and forfeits by. */
const LIVE_PENALTY = {
  accumulation_scope: 'match',
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: FFAMHE_FORFEIT_RULES,
  penalty_ruleset_entries: [{ group_number: 1, ref_number: 'R1', sanctions: ['yellow', 'red'] }],
};

/** The columns the live read must ask for: the doubles answer whatever is asked. */
const LIVE_PENALTY_COLUMNS =
  'accumulation_scope, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, forfeit_rules, penalty_ruleset_entries(group_number, ref_number, sanctions)';

// A TF_v1 (registry-coded) tournament with a pinned custom penalty ruleset, so
// resolveRulesetGrammar + scoringStructureOf both short-circuit to the
// registry and only tournaments + the live penalty_rulesets row are read.
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
        forfeit_rules: o.forfeitChanges ?? null,
      },
    },
    penalty_rulesets: { maybeSingle: { ...LIVE_PENALTY, ...o.penalty } },
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

  // Every forfeit rule moved to the penalty ruleset (rulings 63-76): a club formula's old stored
  // forfeit policy is dead data, and the fingerprint no longer reads it.
  it('a club formula is not described by a forfeit policy its settings still store', async () => {
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
    // Two club-formula Tournaments that differ ONLY in their old forfeit policy.
    const onPolicy = (forfeitPolicy: unknown) => {
      const state = stateFor({ rulesetConfig: { forfeitPolicy } });
      (state.tournaments!.maybeSingle as Record<string, unknown>).ruleset_code = 'custom_club';
      return { ...state, custom_rulesets: clubFormula };
    };
    const matchOnly = { reasons: { black_card_1: { tournamentState: 'match_only' } } };
    expect(await hashOf(onPolicy(matchOnly))).toBe(await hashOf(onPolicy(null)));
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

  // TF_v1's grammar SEEDS deductive; a row that stores no mode plays full (operator ruling 47), and
  // the fingerprint describes what plays, never the seed.
  it('describes a TF_v1 row that stores no afterblow mode as full, as the scorer plays it', async () => {
    const missing = await hashOf(stateFor({ scoringConfig: { afterblowMode: undefined } }));
    const full = await hashOf(stateFor({ scoringConfig: { afterblowMode: 'full' } }));
    expect(missing).toBe(full);
  });

  it('changes when the pinned penalty definition changes (cards change scores)', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(stateFor({ penalty: { red_card_points: -3 } }));
    expect(changed).not.toBe(base);
  });

  it('a forfeit rule change moves the hash (rulings 63-76: a forfeit changes results)', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(
      stateFor({ penalty: { forfeit_rules: { ...FFAMHE_FORFEIT_RULES, disqualifyAfter: 'off' } } }),
    );
    expect(changed).not.toBe(base);
  });

  // A Tournament may change its forfeit rules (ruling 65): the hash describes the rules it plays,
  // its changes over its ruleset's. The doubles answer whatever is asked: the read must ask.
  it('describes a Tournament by its own changes of the forfeit rules, laid over the ruleset', async () => {
    selects.length = 0;
    const base = await hashOf(stateFor());
    expect(
      selects.some((s) => s.table === 'tournaments' && /\bforfeit_rules\b/.test(s.columns)),
    ).toBe(true);
    const after4 = await hashOf(stateFor({ forfeitChanges: { disqualifyAfter: 4 } }));
    const cardBout = await hashOf(stateFor({ forfeitChanges: { secondBlackCard: 'match' } }));
    expect(new Set([base, after4, cardBout]).size).toBe(3);
    // A change the ruleset already holds plays the same rules: the same hash.
    expect(await hashOf(stateFor({ forfeitChanges: { disqualifyAfter: 2 } }))).toBe(base);
    expect(await hashOf(stateFor({ penalty: { second_black_card_forfeit: 'match' } }))).toBe(
      cardBout,
    );
  });

  // The engine scores by the LIVE row. After a pin, an unpin, an edit and a re-pin, the snapshot of
  // the pinned version no longer says what the engine does, so the fingerprint never reads it.
  it('the hash follows the live row, not the pinned snapshot', async () => {
    const live = (second: string) => stateFor({ penalty: { second_black_card_forfeit: second } });
    const withSnapshot: TableState = {
      ...live('match'),
      penalty_ruleset_versions: {
        maybeSingle: {
          ...LIVE_PENALTY,
          second_black_card_forfeit: 'tournament',
          forfeit_rules: { ...FFAMHE_FORFEIT_RULES, disqualifyAfter: 'off' },
          entries: [{ groupNumber: 1, refNumber: 'R1', sanctions: ['yellow', 'red'] }],
        },
      },
    };
    selects.length = 0;
    const hash = await hashOf(withSnapshot);
    expect(selects.filter((s) => s.table === 'penalty_rulesets').map((s) => s.columns)).toEqual([
      LIVE_PENALTY_COLUMNS,
    ]);
    expect(selects.some((s) => s.table === 'penalty_ruleset_versions')).toBe(false);
    expect(hash).toBe(await hashOf(live('match')));
    expect(hash).not.toBe(await hashOf(live('tournament')));
  });

  it('changes when the tournament overrides effective target values', async () => {
    const base = await hashOf(stateFor());
    const changed = await hashOf(
      stateFor({ rulesetConfig: { targets: [{ name: 'deep', value: 3 }] } }),
    );
    expect(changed).not.toBe(base);
  });

  // The forfeit and disqualification rules left the scoring ruleset (rulings 63-76): an old stored
  // tournamentPolicy is dead data, and two Tournaments that differ only by it score the same.
  it('a stored tournamentPolicy does not move the hash', async () => {
    const base = await hashOf(stateFor());
    const withPolicy = await hashOf(
      stateFor({
        rulesetConfig: { tournamentPolicy: { forfeitDrawsCount: true, disqualifyAfter: 3 } },
      }),
    );
    expect(withPolicy).toBe(base);
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
