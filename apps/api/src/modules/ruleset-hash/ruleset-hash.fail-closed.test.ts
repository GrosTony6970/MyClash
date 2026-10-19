import { describe, expect, it, vi } from 'vitest';
import { RulesetHashService } from './ruleset-hash.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/**
 * The readers behind a Tournament's rules fingerprint fail CLOSED: a read that fails throws, never
 * a fallback hashed as the ruleset's (the audited settings change, revision 5 correction 3). And a
 * club FORMULA ruleset is fingerprinted by its own targets, of the version the Tournament pins
 * (operator ruling "Formula targets", 2026-10-19), as the scorer reads them.
 */

type Row = Record<string, unknown>;
interface TableState {
  /** The row every `maybeSingle` of the table answers. */
  row?: Row | null;
  error?: { message: string };
  /** Fail only the read whose column list holds this: two readers share some tables. */
  errorWhen?: string;
}

function fakeSupabase(state: Record<string, TableState>) {
  const updates: Array<{ table: string; row: Row }> = [];
  function chain(table: string) {
    const t = state[table] ?? {};
    let columns = '';
    const failing = () =>
      t.errorWhen === undefined || columns.includes(t.errorWhen) ? t.error : undefined;
    const answer = () => Promise.resolve({ data: t.row ?? null, error: failing() ?? null });
    const api: Record<string, unknown> = {
      select: vi.fn((asked: string) => {
        columns = asked;
        return api;
      }),
      eq: vi.fn(() => api),
      is: vi.fn(() => api),
      limit: vi.fn(() => api),
      maybeSingle: vi.fn(answer),
      update: vi.fn((row: Row) => {
        updates.push({ table, row });
        return api;
      }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: t.row ? [t.row] : [], error: failing() ?? null }),
    };
    return api;
  }
  return { updates, service: { from: vi.fn((table: string) => chain(table)) } };
}

const TOURNAMENT = {
  id: 't-1',
  event_id: 'e-1',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
  scoring_config_json: { afterblowMode: 'deductive' },
  penalty_ruleset_id: null,
  penalty_ruleset_version: null,
};

/** A club formula ruleset: the parent row, and the snapshot of a published version. */
const formulaRow = (targets: Array<{ name: string; value: number }>): Row => ({
  id: 'cr-1',
  is_system: false,
  base_code: null,
  base_version: null,
  score_formula: { op: 'var', name: 'touches' },
  constants: {},
  tiebreakers: [],
  double_penalty_formula: null,
  decision_edition: '2026-10',
  targets,
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
});

const HEAD = [{ name: 'Tête', value: 4 }];
const BODY = [{ name: 'Corps', value: 1 }];
// What every validated Tournament config carries (TFv1ConfigSchema's default targets).
const FEDERAL = [
  { name: 'Deep', value: 2 },
  { name: 'Shallow', value: 1 },
];

function state(over: Record<string, TableState> = {}): Record<string, TableState> {
  return {
    tournaments: { row: TOURNAMENT },
    events: { row: { penalty_ruleset_id: null, penalty_ruleset_version: null } },
    penalty_rulesets: { row: { id: 'pr-built-in', version: '1.0.0' } },
    ...over,
  };
}

const serviceOver = (s: Record<string, TableState>) => {
  const supabase = fakeSupabase(s);
  return { supabase, svc: new RulesetHashService(supabase as never, createRulesetRegistry()) };
};
const hashOf = (s: Record<string, TableState>) =>
  serviceOver(s).svc.computeTournamentContentHash('t-1');

/** A Tournament on a club formula ruleset at v1, with the settings it was validated with. */
const onFormula = (config: Row = {}) => ({
  tournaments: {
    row: {
      ...TOURNAMENT,
      ruleset_code: 'club_f',
      ruleset_version: '1.0.0',
      ruleset_config: config,
    },
  },
});

describe('the rules fingerprint fails closed', () => {
  it.each([
    ["the club ruleset's grammar", 'custom_rulesets', 'base_code, targets', 'was not read'],
    ["the club ruleset's formula", 'custom_rulesets', 'is_system', 'not read for its hash'],
    ['the grammar of the pinned version', 'custom_ruleset_versions', 'targets', 'was not read'],
    [
      'the formula of the pinned version',
      'custom_ruleset_versions',
      'score_formula',
      'not read for its hash',
    ],
  ])(
    'throws when %s cannot be read, never hashing a fallback',
    async (_what, table, when, words) => {
      const s = state({
        ...onFormula(),
        custom_rulesets: { row: formulaRow(HEAD) },
        custom_ruleset_versions: { row: formulaRow(HEAD) },
      });
      s[table] = { ...s[table], error: { message: 'connection reset' }, errorWhen: when };
      await expect(hashOf(s)).rejects.toThrow(words);
    },
  );

  it.each([
    ['the Event card pin', 'events'],
    ['the built-in card rules', 'penalty_rulesets'],
  ])('throws when %s cannot be read', async (_what, table) => {
    await expect(
      hashOf(state({ [table]: { error: { message: 'connection reset' } } })),
    ).rejects.toThrow('connection reset');
  });

  it('throws when card rules pinned with no version cannot be read', async () => {
    const s = state({
      tournaments: { row: { ...TOURNAMENT, penalty_ruleset_id: 'pr-1' } },
      penalty_rulesets: { error: { message: 'connection reset' }, errorWhen: 'accumulation_scope' },
    });
    await expect(hashOf(s)).rejects.toThrow('Card rules pr-1 were not read');
  });

  it('throws when the pinned card rules cannot be read', async () => {
    const s = state({
      tournaments: {
        row: { ...TOURNAMENT, penalty_ruleset_id: 'pr-1', penalty_ruleset_version: '1.0.0' },
      },
      penalty_ruleset_versions: { error: { message: 'connection reset' } },
    });
    await expect(hashOf(s)).rejects.toThrow('connection reset');
  });

  it('stamps nothing when a read fails: the best-effort stamp logs, and no hash built on a fallback is written', async () => {
    const { supabase, svc } = serviceOver(
      state({ events: { error: { message: 'connection reset' } } }),
    );
    await svc.stampTournamentContentHash('t-1');
    expect(supabase.updates).toEqual([]);
  });

  it('refuses to restamp the Tournaments of an Event it could not list', async () => {
    const { svc } = serviceOver(state({ tournaments: { error: { message: 'connection reset' } } }));
    await expect(svc.stampEventInheritingTournaments('e-1')).rejects.toThrow('connection reset');
  });
});

describe('a club formula ruleset is fingerprinted by its own targets, of the pinned version', () => {
  it("reads the ruleset's targets, not the default list the Tournament's settings carry", async () => {
    const withDefaults = await hashOf(
      state({ ...onFormula({ targets: FEDERAL }), custom_rulesets: { row: formulaRow(HEAD) } }),
    );
    const withNone = await hashOf(
      state({ ...onFormula(), custom_rulesets: { row: formulaRow(HEAD) } }),
    );
    const otherTargets = await hashOf(
      state({ ...onFormula({ targets: FEDERAL }), custom_rulesets: { row: formulaRow(BODY) } }),
    );
    expect(withDefaults).toBe(withNone);
    expect(otherTargets).not.toBe(withDefaults);
  });

  it('reads the snapshot of the version the Tournament pins, not the club row of a later one', async () => {
    const pinnedAtV1 = await hashOf(
      state({
        ...onFormula(),
        custom_rulesets: { row: formulaRow(BODY) },
        custom_ruleset_versions: { row: formulaRow(HEAD) },
      }),
    );
    const allHead = await hashOf(
      state({
        ...onFormula(),
        custom_rulesets: { row: formulaRow(HEAD) },
        custom_ruleset_versions: { row: formulaRow(HEAD) },
      }),
    );
    expect(pinnedAtV1).toBe(allHead);
  });

  it("keeps a coded engine's own targets: a TF_v1 Tournament whose settings name targets is hashed by them", async () => {
    const federal = await hashOf(
      state({ tournaments: { row: { ...TOURNAMENT, ruleset_config: { targets: FEDERAL } } } }),
    );
    const head = await hashOf(
      state({ tournaments: { row: { ...TOURNAMENT, ruleset_config: { targets: HEAD } } } }),
    );
    expect(federal).not.toBe(head);
  });
});
