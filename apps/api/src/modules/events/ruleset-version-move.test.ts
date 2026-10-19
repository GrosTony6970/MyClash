/**
 * The rules a Tournament holds when its ruleset pair moves, through the PATCH before any result,
 * the audited re-pin and its preview (`nextOfMove`, the one owner).
 *
 * A version move keeps the settings (operator ruling "A version move", 2026-10-17): a Tournament
 * on TF_v1 1.0.0 with a cap of 7 moves to 1.1.0 and keeps it. A move to another ruleset code
 * starts from that ruleset's defaults, and a club ruleset's other version brings its own content
 * (ruling "Club version", 2026-10-18). The buttons follow the same rule, the display stays (ruling
 * "Draft switch", 2026-10-19), and the seed reads the targets of the pair's kind (ruling "Formula
 * targets").
 *
 * Seeded tables (`mockSupabase`) and the REAL RulesetHashService over them; the re-pin's database
 * function applies what it is sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFv1DefaultConfig } from '@myclash/rulesets';
import { EventsService } from './events.service';
import { seededScoringOfMove, settingsAfterMove } from './ruleset-move-config';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import type * as MatchRuleset from '../phases/match-ruleset';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

type Row = Record<string, unknown>;
const RPC = 'repin_tournament_rules';
const assertOrgRole = vi.fn();

/** The organiser's own settings: a cap of 7 (the default is 10) and a win bonus of 5 (3). */
const OWN = {
  ...TFv1DefaultConfig,
  winBonus: 5,
  matchFormat: { ...TFv1DefaultConfig.matchFormat, pointCap: 7 },
};

/** The federal pad, in the organiser's own colours and quick penalties. */
const OWN_SCORING = {
  afterblowMode: 'deductive',
  buttons: {
    clean: [
      { label: '+2', value: 2, visible: true },
      { label: '+1', value: 1, visible: true },
    ],
    afterblow: [{ label: '2-1', attackerPts: 2, defenderPts: 1, visible: true }],
  },
  display: { sideColors: { red: 'blue', blue: 'red' }, quickPenalties: [1] },
};

const ON_TF_1_0_0: Row = {
  id: 't1',
  event_id: 'e1',
  name: 'Sabre',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: OWN,
  scoring_config_json: OWN_SCORING,
  penalty_ruleset_id: null,
  penalty_ruleset_version: null,
};

/** A club FORMULA ruleset: version 1.0.0 scores head 3 / limb 1, its current 1.0.1 head 4 / limb 2. */
const grammarOf = (head: number, limb: number) => ({
  targets: [
    { name: 'Head', value: head },
    { name: 'Limb', value: limb },
  ],
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
});
const FORMULA = { score_formula: { op: 'var', name: 'hits' }, constants: {}, tiebreakers: [] };
const CLUB = {
  rulesets: [
    {
      id: 'cr-club',
      code: 'custom_club',
      is_system: false,
      base_code: null,
      base_version: null,
      tf_config: null,
      match_format_defaults: { ...TFv1DefaultConfig.matchFormat, pointCap: 12 },
      double_penalty_formula: null,
      ...FORMULA,
      ...grammarOf(4, 2),
    },
  ],
  versions: [
    { custom_ruleset_id: 'cr-club', version: '1.0.0', ...FORMULA, ...grammarOf(3, 1) },
    { custom_ruleset_id: 'cr-club', version: '1.0.1', ...FORMULA, ...grammarOf(4, 2) },
  ],
};
const ON_CLUB_1_0_0 = { ...ON_TF_1_0_0, ruleset_code: 'custom_club', ruleset_version: '1.0.0' };

/** A coded fork of TF_v1 whose tf_config targets (+4/+2) are not its targets column (+2/+1). */
const FORK = {
  rulesets: [
    {
      id: 'cr-fork',
      code: 'custom_fork',
      is_system: false,
      base_code: 'TF_v1',
      base_version: '1.0.0',
      tf_config: {
        targets: [
          { name: 'Deep', value: 4 },
          { name: 'Shallow', value: 2 },
        ],
      },
      match_format_defaults: null,
      double_penalty_formula: null,
      ...grammarOf(2, 1),
    },
  ],
};

function harness(current: Row = ON_TF_1_0_0, custom: { rulesets?: Row[]; versions?: Row[] } = {}) {
  const row = structuredClone(current);
  const db = mockSupabase(
    {
      tournaments: { rows: [row] },
      events: { rows: [{ id: 'e1', organization_id: 'org-1' }] },
      platform_roles: { rows: [] },
      matches: { rows: [] },
      custom_rulesets: { rows: custom.rulesets ?? [] },
      custom_ruleset_versions: { rows: custom.versions ?? [] },
      penalty_rulesets: { rows: [] },
      tournament_ruleset_repins: { rows: [] },
      audit_log: { rows: [] },
    },
    {
      [RPC]: (args) => {
        Object.assign(row, JSON.parse(JSON.stringify(args['p_next'])));
        return { data: 'repin-1', error: null };
      },
    },
  );
  const registry = createRulesetRegistry();
  const svc = new EventsService(
    db as never,
    { assertOrgRole } as never,
    {} as never,
    registry,
    undefined,
    undefined,
    undefined,
    { getPoolStandings: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    {
      offeredVersion: vi.fn().mockResolvedValue('1.0.1'),
      draftsOfferedTo: vi.fn().mockResolvedValue(false),
    } as never,
    new RulesetHashService(db as never, registry),
  );
  /** The rules the move wrote: the PATCH's own update, or what the re-pin sent the database. */
  const written = (): Row | undefined =>
    (writesTo(db, 'tournaments')
      .map((write) => write.row as Row)
      .find((patch) => 'ruleset_config' in patch) ??
      db.rpc.mock.calls.find(([name]) => name === RPC)?.[1]?.['p_next']) as Row | undefined;
  const settings = () =>
    written()?.['ruleset_config'] as Record<string, Record<string, unknown>> | undefined;
  const scoring = () => written()?.['scoring_config_json'] as typeof OWN_SCORING | undefined;
  return { svc, db, settings, scoring, written };
}

const REPIN = {
  justification: 'The end rule of the 2026-10 edition applies from today.',
  confirm: 'sabre',
};
/** The raw rules of a row, as its screen read them. */
const expectedOf = (row: Row) => ({
  rulesetCode: row['ruleset_code'],
  rulesetVersion: row['ruleset_version'],
  rulesetConfig: row['ruleset_config'],
  scoringConfig: row['scoring_config_json'],
  penaltyRulesetId: null,
  penaltyRulesetVersion: null,
});
const repin = (over: Row, row: Row = ON_TF_1_0_0) =>
  ({ ...REPIN, expected: expectedOf(row), ...over }) as never;
const TO_1_1_0 = { rulesetCode: 'TF_v1', rulesetVersion: '1.1.0' };
const labels = (buttons: Array<{ label: string }> | undefined) => buttons?.map((b) => b.label);

describe('settingsAfterMove and seededScoringOfMove', () => {
  const defaults = { winBonus: 3, matchFormat: { pointCap: 10, timeLimitSec: 90 } };
  const stored = { winBonus: 5, matchFormat: { pointCap: 7 } };
  const move = { fromCode: 'TF_v1', toCode: 'TF_v1', builtIn: true, stored, defaults };

  it("keeps a built-in's stored settings across its versions, the defaults filling what is missing", () => {
    expect(settingsAfterMove(move)).toEqual({
      winBonus: 5,
      matchFormat: { pointCap: 7, timeLimitSec: 90 },
    });
    expect(settingsAfterMove({ ...move, stored: null })).toEqual(defaults);
  });

  it("takes the new pair's settings on a move to another code, or within a club ruleset", () => {
    expect(settingsAfterMove({ ...move, toCode: 'Generic_PointsCap' })).toEqual(defaults);
    expect(settingsAfterMove({ ...move, builtIn: false })).toEqual(defaults);
  });

  it("puts the caller's patch on top of either", () => {
    const patch = { matchFormat: { timeLimitSec: 60 } };
    expect(settingsAfterMove({ ...move, patch })).toMatchObject({ matchFormat: { pointCap: 7 } });
    expect(settingsAfterMove({ ...move, builtIn: false, patch })).toEqual({
      winBonus: 3,
      matchFormat: { pointCap: 10, timeLimitSec: 60 },
    });
  });

  it("takes the seed's buttons and afterblow mode, and keeps the stored display", () => {
    const seed = {
      afterblowMode: 'full',
      buttons: { clean: [{ label: '+5', value: 5 }], afterblow: [] },
    };
    expect(seededScoringOfMove(OWN_SCORING, seed)).toMatchObject({
      afterblowMode: 'full',
      buttons: { clean: [{ label: '+5', value: 5 }], afterblow: [] },
      display: OWN_SCORING.display,
    });
  });
});

describe('a move by the PATCH before any result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('TF_v1 1.0.0 to 1.1.0 keeps the settings and writes no scoring config', async () => {
    const { svc, settings, written } = harness();
    await svc.updateTournament('t1', { rulesetVersion: '1.1.0' } as never, 'u1');
    expect(settings()).toMatchObject({ winBonus: 5, matchFormat: { pointCap: 7 } });
    expect(written()).not.toHaveProperty('scoring_config_json');
  });

  it('a setting sent beside that move goes on top', async () => {
    const { svc, settings } = harness();
    await svc.updateTournament(
      't1',
      { rulesetVersion: '1.1.0', rulesetConfig: { targetValues: { deepTarget: 4 } } } as never,
      'u1',
    );
    expect(settings()).toMatchObject({ winBonus: 5, targetValues: { deepTarget: 4 } });
  });

  it('to another code starts from its defaults and its buttons, keeping the display', async () => {
    const { svc, settings, scoring } = harness();
    await svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1');
    expect(settings()?.['matchFormat']?.['pointCap']).toBe(10);
    expect(scoring()).toMatchObject({ afterblowMode: 'full', display: OWN_SCORING.display });
    expect(scoring()?.buttons.afterblow).toEqual([]);
  });

  it('a scoring config sent beside that move goes on top of the seed', async () => {
    const { svc, scoring } = harness();
    await svc.updateTournament(
      't1',
      { rulesetCode: 'Generic_PointsCap', scoringConfig: { afterblowMode: 'deductive' } } as never,
      'u1',
    );
    expect(scoring()).toMatchObject({ afterblowMode: 'deductive', buttons: { afterblow: [] } });
  });

  it("to a club ruleset's other version takes that version's content and targets", async () => {
    const { svc, settings, scoring } = harness(ON_CLUB_1_0_0, CLUB);
    await svc.updateTournament('t1', { rulesetVersion: '1.0.1' } as never, 'u1');
    expect(settings()).toMatchObject({ winBonus: 3, matchFormat: { pointCap: 12 } });
    expect(labels(scoring()?.buttons.clean)).toEqual(['+4', '+2']);
  });

  it("to a coded fork follows its tf_config's targets, not its targets column", async () => {
    const { svc, scoring } = harness(ON_TF_1_0_0, FORK);
    await svc.updateTournament('t1', { rulesetCode: 'custom_fork' } as never, 'u1');
    expect(labels(scoring()?.buttons.clean)).toEqual(['+4', '+2']);
  });
});

describe('a move by the audited re-pin, and its preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('TF_v1 1.0.0 to 1.1.0 keeps the settings and the buttons, and audits against them', async () => {
    const { svc, settings, scoring } = harness();
    const { rulesetChange } = await svc.repinTournamentRuleset('t1', repin(TO_1_1_0), 'u1');
    expect(settings()).toMatchObject({ winBonus: 5, matchFormat: { pointCap: 7 } });
    expect(scoring()).toEqual(OWN_SCORING);
    expect(rulesetChange.diff.ranking).toBe('unchanged');
    // A built-in's versions differ in the end decision only: its engine.
    expect(rulesetChange.changes.map((change) => change.path)).toEqual(['engine']);
  });

  it('to another code starts from its defaults and its buttons, keeping the display', async () => {
    const { svc, settings, scoring } = harness();
    await svc.repinTournamentRuleset('t1', repin({ rulesetCode: 'Generic_PointsCap' }), 'u1');
    expect(settings()?.['matchFormat']?.['pointCap']).toBe(10);
    expect(scoring()).toMatchObject({ afterblowMode: 'full', display: OWN_SCORING.display });
  });

  it("to a club ruleset's other version seeds its targets, and lists the change from the pinned one", async () => {
    const { svc, scoring } = harness(ON_CLUB_1_0_0, CLUB);
    const { rulesetChange } = await svc.repinTournamentRuleset(
      't1',
      repin({ rulesetCode: 'custom_club' }, ON_CLUB_1_0_0),
      'u1',
    );
    expect(labels(scoring()?.buttons.clean)).toEqual(['+4', '+2']);
    expect(rulesetChange.changes).toContainEqual({
      path: 'grammar.targets',
      before: grammarOf(3, 1).targets,
      after: grammarOf(4, 2).targets,
      locked: true,
    });
  });

  it("the preview shows the same lamps and changes as the re-pin's, writing nothing", async () => {
    const { svc, db } = harness();
    const preview = await svc.previewRepinBucketDiff('t1', TO_1_1_0, 'u1');
    expect(db.writes).toEqual([]);
    const { rulesetChange } = await svc.repinTournamentRuleset('t1', repin(TO_1_1_0), 'u1');
    expect(preview.diff).toEqual(rulesetChange.diff);
    expect(preview.changes).toEqual(rulesetChange.changes);
  });
});
