/**
 * Commit 1 of the mid-event re-pin audit slice: guard the score-CHANGING
 * ruleset swap in updateTournament.
 *
 * Standings resolve the tournament's LIVE ruleset pointer at read time
 * (pool-standings.service.ts), so changing ruleset_code / ruleset_version on a
 * tournament that already has scored matches silently re-ranks recorded
 * results. That must never happen through an ordinary settings PATCH — the
 * change has to go through the audited re-pin flow (typed confirmation +
 * justification + public disclosure) built in the later commits.
 *
 * The guard reuses assertNoRecordedResults (previously delete-only) and fires
 * ONLY when the ruleset code/version actually changes. Ordinary edits (name,
 * colour, capacity) on a running tournament are unaffected. The score-preserving
 * "Customise this format" fork uses a separate method (repointTournamentToRuleset),
 * so it is deliberately not touched by this guard.
 *
 * The mock dispatches by TABLE NAME (the matches-mock lesson): an ordered queue
 * desyncs the moment a query is added.
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { restampUnstartedMatches } from '../phases/match-ruleset';
import type * as MatchRuleset from '../phases/match-ruleset';

// The restamp of the bouts not yet started has its own tests
// (`match-ruleset.restamp.test.ts`). Here: which door calls it, and when.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));
/** The Tournaments whose bouts not yet started were stamped again, in order. */
const restamped = () => vi.mocked(restampUnstartedMatches).mock.calls.map((call) => call[1]);

const assertOrgRole = vi.fn();

const EVENT_ROW = { id: 'e1', organization_id: 'org-1' };

interface Captured {
  update: Record<string, unknown> | null;
  phasesQueried: boolean;
}

interface HarnessOpts {
  current: Record<string, unknown>;
  phases?: Array<{ id: string }>;
  scoredMatchCount?: number;
}

function tournamentsChain(current: Record<string, unknown>, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((p: Record<string, unknown>) => {
      cap.update = p;
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { ...current, ...(cap.update ?? {}) }, error: null }),
      ),
  });
  return chain;
}

function eventsChain() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: EVENT_ROW, error: null }),
  });
  return chain;
}

function phasesChain(phases: Array<{ id: string }>, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    in: vi.fn(() => {
      cap.phasesQueried = true;
      return Promise.resolve({ data: phases, error: null });
    }),
  });
  return chain;
}

function matchesChain(scored: number) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    neq: vi.fn().mockResolvedValue({ count: scored }),
  });
  return chain;
}

/** custom_rulesets read during the reseed (no override row) + safe fallback. */
function nullRowChain() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return chain;
}

function harness(opts: HarnessOpts) {
  const cap: Captured = { update: null, phasesQueried: false };
  const phases = opts.phases ?? [];
  const scored = opts.scoredMatchCount ?? 0;
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tournaments') return tournamentsChain(opts.current, cap);
    if (table === 'events') return eventsChain();
    if (table === 'phases') return phasesChain(phases, cap);
    if (table === 'matches') return matchesChain(scored);
    return nullRowChain();
  });
  // A club ruleset this file names is offered to nobody; a built-in needs no read.
  const selectableRulesets = {
    isSelectable: vi.fn().mockResolvedValue(false),
    draftsOfferedTo: vi.fn().mockResolvedValue(false),
  };
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    undefined,
    undefined,
    undefined,
    undefined,
    selectableRulesets as never,
  );
  return { svc, cap, selectableRulesets };
}

const RUNNING_TF = {
  id: 't1',
  event_id: 'e1',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
};

describe('updateTournament — mid-event ruleset re-pin guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('refuses a score-changing ruleset swap once matches are scored', async () => {
    const { svc, cap } = harness({
      current: RUNNING_TF,
      phases: [{ id: 'p1' }],
      scoredMatchCount: 1,
    });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The guard fires before any write: the ruleset is not swapped.
    expect(cap.update).toBeNull();
  });

  it('does NOT block an ordinary (non-ruleset) edit on a tournament with results', async () => {
    const { svc, cap } = harness({
      current: RUNNING_TF,
      phases: [{ id: 'p1' }],
      scoredMatchCount: 5,
    });

    const result = await svc.updateTournament('t1', { name: 'Renamed Bracket' } as never, 'u1');

    expect((result as Record<string, unknown>)['name']).toBe('Renamed Bracket');
    // The results guard is scoped to ruleset changes: a name edit never even
    // counts scored matches.
    expect(cap.phasesQueried).toBe(false);
    expect(cap.update).not.toBeNull();
  });

  it('allows a ruleset swap while the tournament has no scored matches', async () => {
    const { svc, cap } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
      phases: [],
      scoredMatchCount: 0,
    });

    const result = await svc.updateTournament(
      't1',
      { rulesetCode: 'Generic_PointsCap' } as never,
      'u1',
    );

    expect(cap.update?.['ruleset_code']).toBe('Generic_PointsCap');
    // Swap reseeds the config from the new ruleset's defaults.
    expect(cap.update?.['ruleset_config']).toBeDefined();
    expect((result as Record<string, unknown>)['ruleset_code']).toBe('Generic_PointsCap');
  });

  it('refuses a swap to a ruleset pair that does not resolve, before any write', async () => {
    const { svc, cap, selectableRulesets } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
    });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'custom_gone' } as never, 'u1'),
    ).rejects.toThrow('The selected ruleset (custom_gone 1.0.0) does not exist.');
    expect(cap.update).toBeNull();
    // Asked in the Event's organisation's scope: an org admin is offered no draft.
    expect(selectableRulesets.isSelectable).toHaveBeenCalledWith('org-1', 'custom_gone', '1.0.0', {
      withDrafts: false,
    });
  });

  it('saves a Tournament that re-sends a club pair no longer offered: only a change is checked', async () => {
    // Pinned to a club ruleset since archived or unshared: the form re-sends it.
    const { svc, cap, selectableRulesets } = harness({
      current: { ...RUNNING_TF, status: 'draft', ruleset_code: 'custom_x' },
    });

    const dto = { name: 'Renamed', rulesetCode: 'custom_x', rulesetVersion: '1.0.0' };
    await svc.updateTournament('t1', dto as never, 'u1');

    expect(selectableRulesets.isSelectable).not.toHaveBeenCalled();
    expect(cap.update?.['name']).toBe('Renamed');
  });

  it('stores a version named in shorthand as the registry names it', async () => {
    const { svc, cap } = harness({ current: { ...RUNNING_TF, status: 'draft' } });

    await svc.updateTournament('t1', { rulesetCode: 'TF_v1', rulesetVersion: '1' } as never, 'u1');

    expect(cap.update?.['ruleset_version']).toBe('1.0.0');
  });

  it('gives a swapped-in ruleset its own latest version, not the old ruleset’s', async () => {
    const { svc, cap } = harness({ current: { ...RUNNING_TF, status: 'draft' } });

    await svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1');

    expect(cap.update?.['ruleset_version']).toBe('1.1.0');
  });
});

describe('updateTournament: the bouts not yet started take the new ruleset (operator, 2026-10-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });
  const DRAFT = { current: { ...RUNNING_TF, status: 'draft' }, phases: [], scoredMatchCount: 0 };

  it('stamps them again after a ruleset swap', async () => {
    const { svc } = harness(DRAFT);

    await svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1');

    expect(restamped()).toEqual(['t1']);
  });

  it('stamps them again when the form names the ruleset the Tournament already has: a second send repairs a failed one', async () => {
    const { svc } = harness(DRAFT);

    await svc.updateTournament('t1', { rulesetCode: 'TF_v1' } as never, 'u1');

    expect(restamped()).toEqual(['t1']);
  });

  it('stamps them again when the config of the ruleset changes: their hash follows', async () => {
    const { svc } = harness(DRAFT);

    await svc.updateTournament('t1', { rulesetConfig: { winBonus: 4 } } as never, 'u1');

    expect(restamped()).toEqual(['t1']);
  });

  it.each([
    ['the scoring pad alone', { scoringConfig: { afterblowMode: 'deductive' } }],
    ['the version alone', { rulesetVersion: '1.0.0' }],
  ])('stamps them again when the form sends %s', async (_what, dto) => {
    const { svc } = harness(DRAFT);

    await svc.updateTournament('t1', dto as never, 'u1');

    expect(restamped()).toEqual(['t1']);
  });

  it('stamps nothing for an edit that changes no rule', async () => {
    const { svc } = harness(DRAFT);

    await svc.updateTournament('t1', { name: 'Renamed Bracket' } as never, 'u1');

    expect(restamped()).toEqual([]);
  });

  it('stamps nothing when the swap is refused', async () => {
    const { svc } = harness({ current: RUNNING_TF, phases: [{ id: 'p1' }], scoredMatchCount: 1 });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(restamped()).toEqual([]);
  });

  it('does not answer "saved" when the bouts did not take the ruleset', async () => {
    vi.mocked(restampUnstartedMatches).mockRejectedValueOnce(new Error('the write was refused'));
    const { svc } = harness(DRAFT);

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toThrow('the write was refused');
  });
});
