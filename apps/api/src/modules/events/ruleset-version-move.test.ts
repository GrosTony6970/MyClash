/**
 * A version move keeps the settings (operator ruling "A version move",
 * 2026-10-17): a Tournament on TF_v1 1.0.0 with a cap of 7 moves to 1.1.0 and
 * keeps it, through the PATCH before any result, the audited re-pin and its
 * preview. A move to another ruleset code starts from that ruleset's defaults,
 * and a club ruleset's other version brings its own content (ruling "Club
 * version", 2026-10-18). `settingsAfterMove` is the one owner; the doors are
 * proved to ask it.
 *
 * The mock dispatches by TABLE NAME (the matches-mock lesson).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFv1DefaultConfig } from '@myclash/rulesets';
import { EventsService } from './events.service';
import { settingsAfterMove } from './ruleset-move-config';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import type * as MatchRuleset from '../phases/match-ruleset';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

const assertOrgRole = vi.fn();

/** The organiser's own settings: a cap of 7 (the default is 10) and a win bonus of 5 (3). */
const OWN = {
  ...TFv1DefaultConfig,
  winBonus: 5,
  matchFormat: { ...TFv1DefaultConfig.matchFormat, pointCap: 7 },
};

const ON_TF_1_0_0 = {
  id: 't1',
  event_id: 'e1',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: OWN,
};

/** The same Tournament on a club ruleset at 1.0.0; the club has published 1.0.1. */
const ON_CLUB_1_0_0 = { ...ON_TF_1_0_0, ruleset_code: 'custom_club', ruleset_version: '1.0.0' };
const CLUB_1_0_1 = {
  match_format_defaults: { ...TFv1DefaultConfig.matchFormat, pointCap: 12 },
  double_penalty_formula: null,
  base_code: null,
  base_version: null,
  tf_config: null,
};

/** Every write of the `tournaments` row, in order. */
type Updates = Array<Record<string, unknown>>;

function chain(data: unknown, updates?: Updates) {
  const c: Record<string, unknown> = {};
  Object.assign(c, {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    neq: vi.fn(() => c),
    // The rules lock's read of the fought bouts (`tournamentClockOf`): none.
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates?.push(patch);
      return c;
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    single: vi.fn(() =>
      Promise.resolve({ data: { ...(data as object), ...updates?.at(-1) }, error: null }),
    ),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  });
  return c;
}

function harness(current: Record<string, unknown> = ON_TF_1_0_0) {
  const updates: Updates = [];
  const from = vi.fn((table: string) => {
    if (table === 'tournaments') return chain(current, updates);
    if (table === 'events') return chain({ id: 'e1', organization_id: 'org-1' });
    if (table === 'custom_rulesets' && current['ruleset_code'] === 'custom_club')
      return chain(CLUB_1_0_1);
    return chain(null);
  });
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    undefined,
    undefined,
    undefined,
    { getPoolStandings: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    {
      offeredVersion: vi.fn().mockResolvedValue('1.0.1'),
      draftsOfferedTo: vi.fn().mockResolvedValue(false),
    } as never,
  );
  const settings = () =>
    updates.find((patch) => 'ruleset_config' in patch)?.['ruleset_config'] as
      Record<string, Record<string, unknown>> | undefined;
  return { svc, updates, settings };
}

const REPIN = { justification: 'The end rule of the 2026-10 edition applies from today.' };
const TO_1_1_0 = { rulesetCode: 'TF_v1', rulesetVersion: '1.1.0' };

describe('settingsAfterMove', () => {
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
    expect(settingsAfterMove({ ...move, patch })).toEqual({
      winBonus: 5,
      matchFormat: { pointCap: 7, timeLimitSec: 60 },
    });
    expect(settingsAfterMove({ ...move, builtIn: false, patch })).toEqual({
      winBonus: 3,
      matchFormat: { pointCap: 10, timeLimitSec: 60 },
    });
  });
});

describe("a Tournament's settings when its ruleset pair moves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('TF_v1 1.0.0 to 1.1.0 by the PATCH before any result keeps them', async () => {
    const { svc, settings } = harness();
    await svc.updateTournament('t1', { rulesetVersion: '1.1.0' } as never, 'u1');
    expect(settings()).toMatchObject({ winBonus: 5, matchFormat: { pointCap: 7 } });
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

  it('a PATCH to another code starts from its defaults', async () => {
    const { svc, settings } = harness();
    await svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1');
    expect(settings()?.['matchFormat']?.['pointCap']).toBe(10);
  });

  it("a PATCH to a club ruleset's other version takes that version's content", async () => {
    const { svc, settings } = harness(ON_CLUB_1_0_0);
    await svc.updateTournament('t1', { rulesetVersion: '1.0.1' } as never, 'u1');
    expect(settings()).toMatchObject({ winBonus: 3, matchFormat: { pointCap: 12 } });
  });

  it('TF_v1 1.0.0 to 1.1.0 by the audited re-pin keeps them, and audits against them', async () => {
    const { svc, settings } = harness();
    const { rulesetChange } = await svc.repinTournamentRuleset(
      't1',
      { ...TO_1_1_0, ...REPIN } as never,
      'u1',
    );
    expect(settings()).toMatchObject({ winBonus: 5, matchFormat: { pointCap: 7 } });
    expect(rulesetChange.diff.ranking).toBe('unchanged');
  });

  it('a re-pin to another code starts from its defaults', async () => {
    const { svc, settings } = harness();
    await svc.repinTournamentRuleset(
      't1',
      { rulesetCode: 'Generic_PointsCap', ...REPIN } as never,
      'u1',
    );
    expect(settings()?.['matchFormat']?.['pointCap']).toBe(10);
  });

  it("a re-pin's preview shows the same diff as the re-pin's", async () => {
    const { svc, updates } = harness();
    const preview = await svc.previewRepinBucketDiff('t1', TO_1_1_0, 'u1');
    expect(updates).toEqual([]);
    const { rulesetChange } = await svc.repinTournamentRuleset(
      't1',
      { ...TO_1_1_0, ...REPIN } as never,
      'u1',
    );
    expect(preview.diff).toEqual(rulesetChange.diff);
  });
});
