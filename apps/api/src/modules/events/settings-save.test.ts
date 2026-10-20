/**
 * A save of a Tournament's own settings writes what it stored with what was sent on top, nothing
 * else (operator rulings 48, 49, 52; `settingsOfSave`). It used to back-fill the ruleset's
 * defaults: a sparse club row saved with one field changed was written with the ruleset's time
 * limit and soft clock, which nobody chose and the engine did not play, and a TF_v1 forfeit rule.
 *
 * Over the REAL `updateTournament` write and the real fingerprint (`rules-write.fixtures.ts`): the
 * change list it computes is the one the audited settings change will publish.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeMatchFormatConfig } from '@myclash/rulesets';
import type * as MatchRuleset from '../phases/match-ruleset';
import { scoringChangesOf } from './audited-rules-write';
import {
  assertOrgRole,
  CLUB,
  FORK,
  harness,
  ON_CLUB_1_0_0,
  ON_TF_1_0_0,
  type Row,
} from './rules-write.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

/** A club Tournament that stores one setting: its cap. Its ruleset seeds 120 s and soft clock 30. */
const SPARSE_CLUB: Row = { ...ON_CLUB_1_0_0, ruleset_config: { matchFormat: { pointCap: 7 } } };

/** The PATCH, then the change list between the row read and the row written. */
async function save(current: Row, patch: Row, custom = {}) {
  const h = harness(current, custom);
  await h.svc.updateTournament('t1', patch as never, 'u1');
  const after = { ...current, ...h.written() };
  return { ...h, changes: await scoringChangesOf(h.rulesHash, current, after) };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('a save of the match format', () => {
  it("writes the sent cap onto a sparse club row, with none of its ruleset's defaults", async () => {
    const { settings, changes } = await save(
      SPARSE_CLUB,
      { rulesetConfig: { matchFormat: { pointCap: 9 } } },
      CLUB,
    );
    expect(settings()).toEqual({ matchFormat: normalizeMatchFormatConfig({ pointCap: 9 }) });
    expect(changes).toEqual([{ path: 'matchFormat.pointCap', before: 7, after: 9 }]);
  });

  it('lets the sent cap beat a stored legacy one, keeping its legacy time limit', async () => {
    const legacy = {
      ...ON_TF_1_0_0,
      ruleset_config: { matchFormat: { firstToPoints: 7, timeLimitSeconds: 120 } },
    };
    const { settings, changes } = await save(legacy, {
      rulesetConfig: { matchFormat: { pointCap: 9 } },
    });
    expect(settings()?.['matchFormat']).toMatchObject({
      pointCap: 9,
      timeLimitsSeconds: { pool: 120, bracket: 120, finals: 120 },
    });
    expect(changes).toEqual([{ path: 'matchFormat.pointCap', before: 7, after: 9 }]);
  });

  it("refuses a value the engine refuses with a 400 in the engine's words", async () => {
    const h = harness();
    const refused = h.svc.updateTournament(
      't1',
      { rulesetConfig: { matchFormat: { maxDoubleHits: 0 } } } as never,
      'u1',
    );
    await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused).rejects.toThrow(/expected number to be >0/);
  });

  it('refuses a cap sent onto a stored format the engine refuses, with a 400', async () => {
    const refusedRow = { ...SPARSE_CLUB, ruleset_config: { matchFormat: { maxDoubleHits: 0 } } };
    const h = harness(refusedRow, CLUB);
    await expect(
      h.svc.updateTournament(
        't1',
        { rulesetConfig: { matchFormat: { pointCap: 9 } } } as never,
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('repairs a stored format the engine refuses when the save replaces the refused key', async () => {
    const refusedRow = { ...SPARSE_CLUB, ruleset_config: { matchFormat: { maxDoubleHits: 0 } } };
    // No change list: the row read has no fingerprint, its format being refused.
    const { svc, settings } = harness(refusedRow, CLUB);
    const repair = { rulesetConfig: { matchFormat: { maxDoubleHits: 3 } } };
    await svc.updateTournament('t1', repair as never, 'u1');
    expect(settings()).toEqual({ matchFormat: normalizeMatchFormatConfig({ maxDoubleHits: 3 }) });
  });
});

describe('a save of the forfeit rule (rulings 48, 52)', () => {
  const withRule = {
    ...ON_TF_1_0_0,
    ruleset_config: { winBonus: 5, tournamentPolicy: { disqualifyAfter: 2 } },
  };

  it('Off removes a stored rule, and is no 400', async () => {
    const { settings } = await save(withRule, {
      rulesetConfig: { tournamentPolicy: { disqualifyAfter: null } },
    });
    expect(settings()).toEqual({ winBonus: 5, tournamentPolicy: {} });
  });

  it('a policy save that does not send the rule never writes one', async () => {
    const { settings } = await save(
      SPARSE_CLUB,
      {
        rulesetConfig: { tournamentPolicy: { forfeitDrawsCount: true } },
      },
      CLUB,
    );
    expect(settings()).toEqual({
      matchFormat: { pointCap: 7 },
      tournamentPolicy: { forfeitDrawsCount: true },
    });
  });

  it('Off on a Tournament that stores no rule writes nothing, not an empty policy', async () => {
    const { settings } = await save(
      SPARSE_CLUB,
      { rulesetConfig: { tournamentPolicy: { disqualifyAfter: null } } },
      CLUB,
    );
    expect(settings()).toEqual({ matchFormat: { pointCap: 7 } });
  });

  it('writes no Tournament policy to a points-cap Tournament, which has none', async () => {
    const generic = { ...ON_TF_1_0_0, ruleset_code: 'Generic_PointsCap', ruleset_config: {} };
    const { settings } = await save(generic, {
      rulesetConfig: { tournamentPolicy: { forfeitDrawsCount: true } },
    });
    expect(settings()).toEqual({});
  });
});

describe('a save of the display alone changes no scoring rule', () => {
  /** A fork whose ruleset seeds the deductive afterblow; its Tournament stores no mode. */
  const DEDUCTIVE_FORK = {
    rulesets: [{ ...FORK.rulesets[0], has_afterblow: true, afterblow_mode: 'deductive' }],
  };
  const DISPLAY = { scoringConfig: { display: { sideColors: { red: 'blue', blue: 'red' } } } };

  it('on a fork row that stores no afterblow mode: both sides score it full', async () => {
    const fork = {
      ...ON_TF_1_0_0,
      ruleset_code: 'custom_fork',
      scoring_config_json: { buttons: { clean: [], afterblow: [] } },
    };
    const { changes, rulesHash, written } = await save(fork, DISPLAY, DEDUCTIVE_FORK);
    expect(written()).toHaveProperty('scoring_config_json');
    const after = { ...fork, ...written() };
    expect((await rulesHash.scoringCanonicalOf(fork as never))['afterblowMode']).toBe('full');
    expect((await rulesHash.scoringCanonicalOf(after as never))['afterblowMode']).toBe('full');
    expect(changes).toEqual([]);
  });

  it('on a row that stores no buttons', async () => {
    const noButtons = { ...ON_TF_1_0_0, scoring_config_json: { afterblowMode: 'deductive' } };
    const { changes, scoring } = await save(noButtons, DISPLAY);
    // A write happened: the colours sent, the buttons filled as the pad scores them.
    expect(scoring()?.display.sideColors).toEqual({ red: 'blue', blue: 'red' });
    expect(changes).toEqual([]);
  });
});
