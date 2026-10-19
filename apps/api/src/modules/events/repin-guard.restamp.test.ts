/**
 * The settings save gives the bouts not yet started the Tournament's rules of now (operator,
 * 2026-10-11): which save calls the restamp, and when (`repin-guard.fixtures.ts`).
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restampUnstartedMatches } from '../phases/match-ruleset';
import type * as MatchRuleset from '../phases/match-ruleset';
import { assertOrgRole, harness, restamped, RUNNING_TF } from './repin-guard.fixtures';

// The restamp of the bouts not yet started has its own tests
// (`match-ruleset.restamp.test.ts`). Here: which door calls it, and when.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

describe('updateTournament: the bouts not yet started take the new ruleset (operator, 2026-10-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });
  const DRAFT = { current: { ...RUNNING_TF, status: 'draft' }, bouts: [] };

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
    const { svc } = harness({ current: RUNNING_TF, bouts: [{ status: 'completed' }] });

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
