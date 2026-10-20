/**
 * `GET /tournaments/:id` answers the rules a Tournament plays under (`effectiveRules`, operator
 * ruling 46): the engine's own values where the row stores nothing, the forfeit rule as the
 * forfeit reader applies it, and `start`, what its pair seeds at the PINNED version (ruling 51).
 * A stored config the engine refuses must not take the whole page down: the raw row still loads.
 *
 * Over the real service, controller and ruleset resolver (`rules-write.fixtures.ts`).
 */
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeMatchFormatConfig } from '@myclash/rulesets';
import { DEFAULT_TOURNAMENT_LOCK_CONFIG, type EffectiveRules } from '@myclash/types';
import {
  assertOrgRole,
  CLUB,
  FORK,
  harness,
  ON_CLUB_1_0_0,
  ON_TF_1_0_0,
  type Row,
} from './rules-write.fixtures';
import { readMatchConfig } from './match-config';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { mockSupabase } from '../../common/testing/supabase-chain';

/** A club Tournament that stores one setting, no scoring config and no lock config. */
const SPARSE_CLUB: Row = {
  ...ON_CLUB_1_0_0,
  ruleset_config: { matchFormat: { pointCap: 7 } },
  scoring_config_json: null,
  lock_config_json: null,
};

async function rulesOf(current: Row, custom = {}, tables = {}) {
  const answer = (await harness(current, custom, tables).getTournament()) as Row & {
    effectiveRules: EffectiveRules | null;
  };
  return answer;
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('the rules in force of a sparse club Tournament', () => {
  it("are the engine's values where the row stores nothing", async () => {
    const { effectiveRules } = await rulesOf(SPARSE_CLUB, CLUB);
    expect(effectiveRules?.matchFormat).toEqual(normalizeMatchFormatConfig({ pointCap: 7 }));
    expect(effectiveRules?.matchFormat).toMatchObject({
      pointCap: 7,
      timeLimitsSeconds: { pool: 90 },
      softClockLimitSeconds: 5,
      maxDoubleHits: 4,
    });
    // A club formula owns no TF_v1 setting.
    expect(effectiveRules?.tf).toBeNull();
    expect(effectiveRules?.scoring.afterblowMode).toBe('full');
    // The pad a Tournament with no buttons stored scores with: the federal +2/+1, 2-1/1-1.
    expect(effectiveRules?.scoring.buttons.clean.map((b) => b.label)).toEqual(['+2', '+1']);
    expect(effectiveRules?.scoring.buttons.afterblow.map((b) => b.label)).toEqual(['2-1', '1-1']);
    expect(effectiveRules?.lock).toEqual(DEFAULT_TOURNAMENT_LOCK_CONFIG);
    // Exactly what the screens show: no forfeit policy, no double penalty formula.
    expect(Object.keys(effectiveRules ?? {}).sort()).toEqual([
      'lock',
      'matchFormat',
      'scoring',
      'start',
      'tf',
    ]);
    expect(Object.keys(effectiveRules?.start ?? {}).sort()).toEqual([
      'matchFormat',
      'scoring',
      'tf',
    ]);
  });

  it('start from the seed of the version it is pinned at, not the current one', async () => {
    const { effectiveRules } = await rulesOf(SPARSE_CLUB, CLUB);
    // 1.0.0 seeds a cap of 11; the parent row (the draft after 1.0.1) seeds 13.
    expect(effectiveRules?.start?.matchFormat).toMatchObject({
      pointCap: 11,
      softClockLimitSeconds: 30,
      timeLimitsSeconds: { pool: 120 },
    });
    expect(effectiveRules?.start?.scoring.buttons.clean.map((b) => b.value)).toEqual([3, 1]);
  });

  it('keep the raw columns beside them', async () => {
    const answer = await rulesOf(SPARSE_CLUB, CLUB);
    expect(answer['ruleset_config']).toEqual({ matchFormat: { pointCap: 7 } });
    expect(answer['lock_config_json']).toBeNull();
  });
});

describe('the TF_v1 settings in force', () => {
  const SPARSE_TF = { ...ON_TF_1_0_0, ruleset_config: { winBonus: 5 } };

  it('answer the win bonus and the targets, and no forfeit rule (rulings 63, 68)', async () => {
    const { effectiveRules } = await rulesOf(SPARSE_TF);
    expect(effectiveRules?.tf).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 2, shallowTarget: 1 },
    });
  });

  it("are a coded fork's own, which it owns as TF_v1 does", async () => {
    const fork = { ...ON_TF_1_0_0, ruleset_code: 'custom_fork', ruleset_config: { winBonus: 5 } };
    const { effectiveRules } = await rulesOf(fork, FORK);
    expect(effectiveRules?.tf).toMatchObject({ winBonus: 5 });
  });

  it('answer no forfeit rule a scoring config still stores', async () => {
    const stored = { ...ON_TF_1_0_0, ruleset_config: { tournamentPolicy: { disqualifyAfter: 3 } } };
    const { effectiveRules } = await rulesOf(stored);
    expect(effectiveRules?.tf).not.toHaveProperty('tournamentPolicy');
  });
});

describe('a Tournament whose rules cannot be answered', () => {
  it('still loads its row when the engine refuses its stored settings, and says so', async () => {
    const refused = { ...ON_TF_1_0_0, ruleset_config: { winBonus: -1 } };
    const answer = await rulesOf(refused);
    expect(answer.effectiveRules).toBeNull();
    expect(answer['ruleset_config']).toEqual({ winBonus: -1 });
    // The row's fault, not the server's: a warning.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Tournament t1: the rules in force/));
    expect(error).not.toHaveBeenCalledWith(expect.stringMatching(/^Tournament t1/), undefined);
  });

  it('still loads its row when its pair does not resolve', async () => {
    const answer = await rulesOf({
      ...ON_TF_1_0_0,
      ruleset_code: 'gone',
      ruleset_version: '1.0.0',
    });
    expect(answer.effectiveRules).toBeNull();
  });

  it('answers no start, and its rules, when its seed cannot be read', async () => {
    const tables = { custom_rulesets: { data: null, error: { message: 'connection reset' } } };
    const { effectiveRules } = await rulesOf(ON_TF_1_0_0, {}, tables);
    expect(effectiveRules?.matchFormat.pointCap).toBe(7);
    expect(effectiveRules?.start).toBeNull();
    // A failed read is the server's fault, logged with its stack: never mistaken for a refused row.
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Tournament t1: the rules it starts from not answered: .*connection reset/,
      ),
      expect.stringContaining('connection reset'),
    );
  });

  it('answers no start, and its rules, when the engine refuses its seed', async () => {
    const refusedSeed = {
      ...CLUB,
      versions: CLUB.versions.map((v) => ({ ...v, match_format_defaults: { maxDoubleHits: 0 } })),
    };
    const { effectiveRules } = await rulesOf(SPARSE_CLUB, refusedSeed);
    expect(effectiveRules?.matchFormat.pointCap).toBe(7);
    expect(effectiveRules?.start).toBeNull();
  });
});

describe("the pad's rules (`GET tournaments/:id/match-config`) carry no forfeit rule", () => {
  it('drop one a scoring config still stores: the penalty ruleset owns them', async () => {
    const event = { id: 'e1', status: 'published', organization_id: 'org-1', event_kind: null };
    const rulesetConfig = { tournamentPolicy: { disqualifyAfter: 3 }, forfeitPolicy: {} };
    const db = mockSupabase({
      tournaments: { rows: [{ ...ON_TF_1_0_0, ruleset_config: rulesetConfig, events: event }] },
    });
    const rulesets = new RulesetResolver(db as never, createRulesetRegistry());
    const deps = { supabase: db, orgs: {}, rulesets } as never;
    const answer = await readMatchConfig(deps, 't1', { userId: 'anonymous', staff: null });
    expect(answer.rulesetConfig).not.toHaveProperty('tournamentPolicy');
    expect(answer.rulesetConfig).not.toHaveProperty('forfeitPolicy');
  });
});
