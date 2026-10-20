/**
 * The rules a Tournament holds when its ruleset pair moves, through the PATCH before any result,
 * the audited re-pin and its preview (`nextOfMove`, the one owner).
 *
 * A version move keeps the settings (operator ruling "A version move", 2026-10-17): a Tournament
 * on TF_v1 1.0.0 with a cap of 7 moves to 1.1.0 and keeps it. A move to another ruleset code
 * starts from that ruleset's defaults, and a club ruleset's other version brings its own content
 * (ruling "Club version", 2026-10-18). The buttons follow the same rule, the display stays (ruling
 * "Draft switch", 2026-10-19), and the seed reads the targets of the pair's kind (ruling "Formula
 * targets"). A move to a club formula writes only its own seed and the patch (ruling 53,
 * 2026-10-20), and Off for the forfeit rule removes it on a move too (ruling 52).
 *
 * The harness: `rules-write.fixtures.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seededScoringOfMove, settingsAfterMove, settingsOfSeed } from './ruleset-move-config';
import type * as MatchRuleset from '../phases/match-ruleset';
import {
  assertOrgRole,
  CLUB,
  clubFormatOf,
  FORK,
  grammarOf,
  harness,
  ON_CLUB_1_0_0,
  ON_TF_1_0_0,
  OWN,
  OWN_SCORING,
  type Row,
} from './rules-write.fixtures';
import { filtersFor, selectsFor } from '../../common/testing/supabase-chain';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

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
/** A TF_v1 Tournament whose organiser chose Off for the forfeit rule: no `disqualifyAfter`. */
const OFF_RULE: Row = {
  ...ON_TF_1_0_0,
  ruleset_config: {
    ...OWN,
    tournamentPolicy: { forfeitDrawsCount: true, forfeitFighterBefore1stMatch: false },
  },
};
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

  it("puts the caller's cap on top of a kept legacy one, which the engine would prefer", () => {
    const seed = { matchFormat: { firstToPoints: 5 } };
    const patch = { matchFormat: { pointCap: 7 } };
    const coded = settingsOfSeed({ code: 'TF_v1', kind: 'coded', seed, patch });
    expect(coded['matchFormat']).toMatchObject({ pointCap: 7 });
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

  it('TF_v1 1.0.0 to 1.1.0 keeps an Off forfeit rule off: the defaults do not fill it (ruling 48)', async () => {
    const { svc, settings } = harness(OFF_RULE);
    await svc.updateTournament('t1', { rulesetVersion: '1.1.0' } as never, 'u1');
    expect(settings()?.['tournamentPolicy']).toEqual({
      forfeitDrawsCount: true,
      forfeitFighterBefore1stMatch: false,
    });
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

  it("to a club ruleset's other version takes that version's own seed and targets, nothing more", async () => {
    const { svc, db, settings, scoring } = harness(ON_CLUB_1_0_0, CLUB);
    await svc.updateTournament('t1', { rulesetVersion: '1.0.1' } as never, 'u1');
    // The 1.0.1 snapshot's seed, not the parent row's (a cap of 13), and no key of TF_v1's own.
    expect(settings()).toEqual({ matchFormat: clubFormatOf(12) });
    expect(labels(scoring()?.buttons.clean)).toEqual(['+4', '+2']);
    // The seed is read from the version asked, as the scorer reads it.
    expect(selectsFor(db.from, 'custom_ruleset_versions')).toContain(
      'match_format_defaults, double_penalty_formula',
    );
    expect(filtersFor(db.from, 'custom_ruleset_versions', 'eq')).toEqual(
      expect.arrayContaining([
        ['custom_ruleset_id', 'cr-club'],
        ['version', '1.0.1'],
      ]),
    );
  });

  it('from TF_v1 to a club formula writes no forfeit rule, nor any other key of TF_v1 (ruling 53)', async () => {
    const { svc, settings } = harness(ON_TF_1_0_0, CLUB);
    await svc.updateTournament('t1', { rulesetCode: 'custom_club' } as never, 'u1');
    expect(settings()).toEqual({ matchFormat: clubFormatOf(12) });
  });

  it('a setting sent beside a move to a club formula goes on top of its seed, alone', async () => {
    const { svc, settings } = harness(ON_TF_1_0_0, CLUB);
    await svc.updateTournament(
      't1',
      { rulesetCode: 'custom_club', rulesetConfig: { matchFormat: { pointCap: 9 } } } as never,
      'u1',
    );
    expect(Object.keys(settings() ?? {})).toEqual(['matchFormat']);
    expect(settings()?.['matchFormat']).toMatchObject({
      pointCap: 9,
      softClockLimitSeconds: 30,
      timeLimitsSeconds: { pool: 120, bracket: 120, finals: 120 },
    });
  });

  it("to a coded fork follows its tf_config's targets, not its targets column", async () => {
    const { svc, scoring } = harness(ON_TF_1_0_0, FORK);
    await svc.updateTournament('t1', { rulesetCode: 'custom_fork' } as never, 'u1');
    expect(labels(scoring()?.buttons.clean)).toEqual(['+4', '+2']);
  });

  it('to a coded fork still writes the full settings, its own forfeit rule among them', async () => {
    const { svc, settings } = harness(ON_TF_1_0_0, FORK);
    await svc.updateTournament('t1', { rulesetCode: 'custom_fork' } as never, 'u1');
    expect(settings()).toMatchObject({ winBonus: 3, tournamentPolicy: { disqualifyAfter: 4 } });
  });

  it('Off for the forfeit rule, sent beside a move, removes the setting and is no 400', async () => {
    const { svc, settings } = harness();
    await svc.updateTournament(
      't1',
      {
        rulesetVersion: '1.1.0',
        rulesetConfig: { tournamentPolicy: { disqualifyAfter: null } },
      } as never,
      'u1',
    );
    expect(settings()?.['tournamentPolicy']).not.toHaveProperty('disqualifyAfter');
    expect(settings()).toMatchObject({
      winBonus: 5,
      tournamentPolicy: { forfeitDrawsCount: false },
    });
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

  it('TF_v1 1.0.0 to 1.1.0 keeps an Off forfeit rule off, and lists no policy change', async () => {
    const { svc, settings } = harness(OFF_RULE);
    const { rulesetChange } = await svc.repinTournamentRuleset(
      't1',
      repin(TO_1_1_0, OFF_RULE),
      'u1',
    );
    expect(settings()?.['tournamentPolicy']).not.toHaveProperty('disqualifyAfter');
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
