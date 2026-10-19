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
 * The guard asks the one clock of a Tournament's rules (`tournamentClockOf`) and
 * fires ONLY when the ruleset code/version actually changes. Ordinary edits (name,
 * colour, capacity) on a running tournament are unaffected. The score-preserving
 * "Customise this format" fork uses a separate method (repointTournamentToRuleset),
 * so it is deliberately not touched by this guard.
 *
 * The mock dispatches by TABLE NAME (the matches-mock lesson): an ordered queue
 * desyncs the moment a query is added.
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MatchRuleset from '../phases/match-ruleset';
import { assertOrgRole, harness, RUNNING_TF } from './repin-guard.fixtures';

// The restamp of the bouts not yet started has its own tests
// (`match-ruleset.restamp.test.ts`). Here: which door calls it, and when.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

describe('updateTournament — mid-event ruleset re-pin guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('refuses a score-changing ruleset swap once matches are scored', async () => {
    const { svc, cap } = harness({
      current: RUNNING_TF,
      bouts: [{ status: 'completed' }],
    });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The guard fires before any write: the ruleset is not swapped.
    expect(cap.update).toBeNull();
    // It asks for THIS Tournament's fought bouts (the clock's one read).
    expect(cap.boutsRead).toEqual({
      select: 'id, phases!inner(tournament_id)',
      filters: [
        ['eq', 'phases.tournament_id', 't1'],
        ['neq', 'status', 'scheduled'],
      ],
    });
  });

  it('refuses a card rules change once a bout is fought, on the same clock', async () => {
    const { svc, cap } = harness({ current: RUNNING_TF, bouts: [{ status: 'running' }] });

    await expect(
      svc.updateTournament('t1', { penaltyRulesetId: 'pr-2' } as never, 'u1'),
    ).rejects.toThrow('its penalty ruleset is locked');
    expect(cap.update).toBeNull();
    expect(cap.boutsRead?.select).toBe('id, phases!inner(tournament_id)');
  });

  it('locks on a voided bout too: voiding a bout does not void its cards, which still count', async () => {
    const { svc, cap } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
      bouts: [{ status: 'voided' }, { status: 'scheduled' }],
    });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cap.update).toBeNull();
  });

  it('lets a Tournament whose bouts are all still scheduled swap', async () => {
    const { svc, cap } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
      bouts: [{ status: 'scheduled' }, { status: 'scheduled' }],
    });

    await svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1');

    expect(cap.update?.['ruleset_code']).toBe('Generic_PointsCap');
  });

  it('refuses the swap when the bouts cannot be read: read as none, it went through mid-event', async () => {
    const { svc, cap } = harness({
      current: RUNNING_TF,
      boutsError: { message: 'connection reset' },
    });

    await expect(
      svc.updateTournament('t1', { rulesetCode: 'Generic_PointsCap' } as never, 'u1'),
    ).rejects.toThrow('were not read for its lock: connection reset');
    expect(cap.update).toBeNull();
  });

  it('does NOT block an ordinary (non-ruleset) edit on a tournament with results', async () => {
    const { svc, cap } = harness({
      current: RUNNING_TF,
      bouts: Array.from({ length: 5 }, () => ({ status: 'completed' })),
    });

    const result = await svc.updateTournament('t1', { name: 'Renamed Bracket' } as never, 'u1');

    expect((result as Record<string, unknown>)['name']).toBe('Renamed Bracket');
    // The results guard is scoped to ruleset changes: a name edit never even
    // reads the bouts.
    expect(cap.boutsRead).toBeNull();
    expect(cap.update).not.toBeNull();
  });

  it('allows a ruleset swap while the tournament has no scored matches', async () => {
    const { svc, cap } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
      bouts: [],
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
    ).rejects.toThrow('The selected ruleset (custom_gone) does not exist.');
    expect(cap.update).toBeNull();
    // Asked in the Event's organisation's scope: an org admin is offered no draft.
    // No version named: the ruleset's current one (ruling "No version named").
    expect(selectableRulesets.offeredVersion).toHaveBeenCalledWith(
      'org-1',
      'custom_gone',
      undefined,
      {
        withDrafts: false,
      },
    );
  });

  it('swaps to a club ruleset named with no version at its current one', async () => {
    const { svc, cap, selectableRulesets } = harness({
      current: { ...RUNNING_TF, status: 'draft' },
    });
    selectableRulesets.offeredVersion.mockResolvedValue('1.0.1');

    await svc.updateTournament('t1', { rulesetCode: 'custom_house' } as never, 'u1');

    expect(cap.update?.['ruleset_code']).toBe('custom_house');
    expect(cap.update?.['ruleset_version']).toBe('1.0.1');
  });

  it('saves a Tournament that re-sends a club pair no longer offered: only a change is checked', async () => {
    // Pinned to a club ruleset since archived or unshared: the form re-sends it.
    const { svc, cap, selectableRulesets } = harness({
      current: { ...RUNNING_TF, status: 'draft', ruleset_code: 'custom_x' },
    });

    const dto = { name: 'Renamed', rulesetCode: 'custom_x', rulesetVersion: '1.0.0' };
    await svc.updateTournament('t1', dto as never, 'u1');

    expect(selectableRulesets.offeredVersion).not.toHaveBeenCalled();
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
