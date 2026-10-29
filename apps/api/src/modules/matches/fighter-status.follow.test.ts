/**
 * `FighterStatusService.followRulesChange` (the audited settings change, commit 5b; rulings 143,
 * 144, 149): every settle of the follow reads the rules in force itself (it is handed none), acts
 * for the organiser, and holds its hand-off to the completion owner; the hand-off is made ONCE,
 * after the last settle. The order and the hold-back are `follow-rules-change.test.ts`'s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { statusCollaborators, fighterStatusOver } from './fighter-status.fixtures';
import type { SettleInput } from './fighter-status.service';
import type { RulesMove } from './follow-rules-change';

const CHANGE: RulesMove = { before: {}, after: { disqualifyAfter: 2 }, beforeUnparsable: false };

const ROWS = ['reg-paul', 'reg-jean'].map((id) => ({
  registration_id: id,
  status_now: 'registered',
  status_before: 'registered',
  status_after: 'disqualified',
  crossed_at: null,
}));

/** The service over a database whose list of the Fighters is `ROWS`; each settle completes a bout. */
function follow(units: Record<string, string>) {
  const deps = statusCollaborators();
  // Loop 1 lists both; once settled, loop 2 finds no one out of step.
  const db = {
    rpc: vi
      .fn()
      .mockResolvedValueOnce({ data: ROWS, error: null })
      .mockResolvedValue({ data: [], error: null }),
  };
  const service = fighterStatusOver({ service: db }, deps);
  const settle = vi
    .spyOn(service, 'settle')
    .mockImplementation(async (input: SettleInput, held) => {
      held!.boutPerUnit.set(units[input.registrationId]!, `bout-of-${input.registrationId}`);
      return { before: 'registered', after: 'disqualified', forfeited: 1, broughtBack: 0 };
    });
  return { service, settle, deps };
}

beforeEach(() => vi.clearAllMocks());

describe('the follow of a rules change, as the status service runs it', () => {
  it('settles each Fighter with no rules handed, for the organiser, its hand-off held', async () => {
    const { service, settle } = follow({ 'reg-paul': 'pool-1', 'reg-jean': 'pool-1' });
    await service.followRulesChange('t1', CHANGE, { userId: 'u1' });

    const inputs = settle.mock.calls.map(([input]) => input);
    expect(inputs).toEqual([
      { registrationId: 'reg-paul', tournamentId: 't1', actor: { userId: 'u1' } },
      { registrationId: 'reg-jean', tournamentId: 't1', actor: { userId: 'u1' } },
    ]);
    // One held hand-off for the whole follow.
    expect(settle.mock.calls[0]![1]).toBeDefined();
    expect(settle.mock.calls[1]![1]).toBe(settle.mock.calls[0]![1]);
  });

  it('hands each unit on once, after the last settle', async () => {
    const { service, settle, deps } = follow({ 'reg-paul': 'pool-1', 'reg-jean': 'pool-1' });
    const answer = await service.followRulesChange('t1', CHANGE, {});

    expect(deps.matchCompletion.onMatchCompleted).toHaveBeenCalledTimes(1);
    const lastSettle = Math.max(...settle.mock.invocationCallOrder);
    expect(deps.matchCompletion.onMatchCompleted.mock.invocationCallOrder[0]).toBeGreaterThan(
      lastSettle,
    );
    expect(answer.handOffFailed).toBe(false);
  });

  it('answers a hand-off that failed, never a throw: the rules are written', async () => {
    const { service, deps } = follow({ 'reg-paul': 'pool-1', 'reg-jean': 'pool-2' });
    deps.matchCompletion.onMatchCompleted.mockRejectedValueOnce(new Error('bracket down'));

    const answer = await service.followRulesChange('t1', CHANGE, {});
    expect(answer).toMatchObject({ handOffFailed: true, notSettled: [] });
  });
});
