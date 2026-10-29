/**
 * The audited save of a Tournament's forfeit rules (the audited settings change, commit 5b; operator
 * rulings 142-144, 147, 149). The organiser confirms the change the lock refused; one database call
 * writes the forfeit rules with the record (`repin_tournament_rules`, 0246), and then the Fighters
 * the change moves follow (`FighterStatusService.followRulesChange`, its own tests in
 * `follow-rules-change.test.ts`): never before the write, never undoing it. Who did not follow is
 * answered by name (ruling 144).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import type * as MatchRuleset from '../phases/match-ruleset';
import { writesTo } from '../../common/testing/supabase-chain';
import { settleRules } from '../matches/fighter-status.service';
import { assertOrgRole, expectedOf, refusal, RPC, type Row } from './rules-write.fixtures';
import { forfeitHarness, runningWith, save } from './settings-forfeit.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

const OFF = settleRules({
  ...CLUB_START_FORFEIT_RULES,
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
});
const AFTER_2 = { ...OFF, disqualifyAfter: 2 };

const audit = (row: Row, over: Row = {}) => ({
  justification: 'Two forfeits now disqualify, as the federation asks.',
  confirm: String(row['name']),
  expected: expectedOf(row),
  ...over,
});

/** The arguments of the audited write. */
const repinArgs = (h: ReturnType<typeof forfeitHarness>) =>
  h.db.rpc.mock.calls.find(([name]) => name === RPC)?.[1] as Row | undefined;

describe('an audited forfeit rules change', () => {
  it('writes the forfeit rules with the record, compared with what the screen read', async () => {
    const current = runningWith({ reasons: { injury: { fighter: 'withdrawn' } } });
    const h = forfeitHarness({ current });
    await save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: audit(current) });

    const args = repinArgs(h)!;
    expect((args['p_expected'] as Row)['forfeit_rules']).toEqual({
      reasons: { injury: { fighter: 'withdrawn' } },
    });
    expect((args['p_next'] as Row)['forfeit_rules']).toEqual({
      reasons: { injury: { fighter: 'withdrawn' } },
      disqualifyAfter: 2,
    });
    const record = args['p_audit'] as Row;
    expect((record['config_before'] as Row)['forfeitRules']).toEqual({
      reasons: { injury: { fighter: 'withdrawn' } },
    });
    expect((record['config_after'] as Row)['forfeitRules']).toMatchObject({ disqualifyAfter: 2 });
    expect(record['changes']).toEqual([
      { path: 'forfeitRules.disqualifyAfter', before: 'off', after: 2, locked: true },
    ]);
  });

  it('then has the Fighters follow under the rules before and after, after the write', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current });
    await save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: audit(current) });

    expect(h.followRulesChange).toHaveBeenCalledTimes(1);
    expect(h.followRulesChange).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ before: OFF, after: AFTER_2, beforeUnparsable: false }),
      { userId: 'u1' },
    );
    const written = h.db.rpc.mock.invocationCallOrder[0]!;
    expect(h.followRulesChange.mock.invocationCallOrder[0]).toBeGreaterThan(written);
  });

  it('hands the follow a repair as a repair: whom the dialog named, it moved (ruling 161)', async () => {
    // "Disqualify after 99" is out of range: the stored change cannot be read.
    const current = runningWith({ disqualifyAfter: 99 } as never);
    const h = forfeitHarness({ current });
    await save(h.svc, { forfeitRules: { disqualifyAfter: null }, audit: audit(current) });

    expect(h.followRulesChange).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ before: OFF, after: OFF, beforeUnparsable: true }),
      { userId: 'u1' },
    );
  });

  it('answers who did not follow by name, null for one it cannot name, and both flags', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({
      current,
      followed: {
        notSettled: ['reg-paul', 'reg-gone'],
        inStep: ['reg-jean'],
        handOffFailed: true,
        followFailed: true,
      },
    });
    const answer = (await save(h.svc, {
      forfeitRules: { disqualifyAfter: 2 },
      audit: audit(current),
    })) as Row;

    expect(answer['rulesetChange']).toEqual({
      changes: [{ path: 'forfeitRules.disqualifyAfter', before: 'off', after: 2, locked: true }],
      readBackFailed: false,
      notSettled: [
        { registrationId: 'reg-paul', name: 'Paul Martin' },
        { registrationId: 'reg-gone', name: null },
      ],
      inStep: [{ registrationId: 'reg-jean', name: 'Jean Dupont' }],
      handOffFailed: true,
      followFailed: true,
    });
  });

  it('has no one follow a per-reason score change: it moves no status', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current });
    const answer = (await save(h.svc, {
      forfeitRules: { reasons: { injury: { opponentScore: 9 } } },
      audit: audit(current),
    })) as Row;

    expect(repinArgs(h)).toBeDefined();
    expect(h.followRulesChange).not.toHaveBeenCalled();
    expect((answer['rulesetChange'] as Row)['notSettled']).toEqual([]);
  });

  it('follows even when the row is not read back after the write', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current });
    const apply = h.db.rpc.getMockImplementation()!;
    h.db.rpc.mockImplementationOnce((name: string, args?: Row) => {
      const answer = apply(name, args);
      h.row['id'] = 'moved';
      return answer;
    });
    const answer = (await save(h.svc, {
      forfeitRules: { disqualifyAfter: 2 },
      audit: audit(current),
    })) as Row;

    expect(answer['tournament']).toBeNull();
    expect((answer['rulesetChange'] as Row)['readBackFailed']).toBe(true);
    expect(h.followRulesChange).toHaveBeenCalledTimes(1);
  });
});

describe('what an audited forfeit rules change leaves behind', () => {
  it('a fingerprint of the rules written, forfeit rules included: no drift after it', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current });
    await save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: audit(current) });

    // The double writes `p_next` over the row, as the function does.
    expect(h.row['forfeit_rules']).toEqual({ disqualifyAfter: 2 });
    expect(h.row['ruleset_content_hash']).toBe(await h.rulesHash.contentHashOf(h.row as never));
  });

  it('names no Fighter in the record or the audit trail: names are the dialog’s alone', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({
      current,
      followed: { notSettled: ['reg-paul'], inStep: [], handOffFailed: false, followFailed: false },
    });
    await save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: audit(current) });

    const trail = JSON.stringify([repinArgs(h), writesTo(h.db, 'audit_log')]);
    expect(trail).not.toMatch(/reg-paul|Paul Martin/);
  });
});

describe('an audited save and the forfeit rules it does not change', () => {
  it('writes the stored forfeit rules again, as they are, on a scoring change', async () => {
    const stored = { disqualifyAfter: 3, reasons: { voluntary: {} } };
    const current = runningWith(stored as never);
    const h = forfeitHarness({ current });
    await save(h.svc, {
      rulesetConfig: { matchFormat: { pointCap: 9 } },
      audit: audit(current),
    });

    expect((repinArgs(h)!['p_next'] as Row)['forfeit_rules']).toEqual(stored);
    expect(h.followRulesChange).not.toHaveBeenCalled();
  });
});

describe('an audited forfeit rules change refused', () => {
  it('is refused 409 when the forfeit rules moved since the screen read them', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current });
    const stale = audit(current, {
      expected: { ...expectedOf(current), forfeitRules: { disqualifyAfter: 5 } },
    });
    const { status, body } = await refusal(
      save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: stale }),
    );

    expect([status, body['code']]).toEqual([409, 'rules_changed_since_read']);
    expect(repinArgs(h)).toBeUndefined();
    expect(h.followRulesChange).not.toHaveBeenCalled();
  });

  it('writes nothing when the status settle is not wired: a wiring fault, before the write', async () => {
    const current = runningWith(null);
    const h = forfeitHarness({ current, noFighterStatus: true });
    await expect(
      save(h.svc, { forfeitRules: { disqualifyAfter: 2 }, audit: audit(current) }),
    ).rejects.toThrow('the status settle is not wired');
    expect(repinArgs(h)).toBeUndefined();
  });
});
