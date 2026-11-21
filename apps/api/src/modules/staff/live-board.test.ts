// apps/api/src/modules/staff/live-board.test.ts
import { describe, expect, it } from 'vitest';
import { assembleBoardRows } from './live-board';
import { account, base, match } from './live-board.fixtures';

describe('assembleBoardRows', () => {
  it('picks a running match as current and maps score + fighters', () => {
    const input = base();
    input.matches = [
      match({
        status: 'running',
        red_score: 3,
        blue_score: 2,
        match_number_label: '#3',
        bracket_slots: { round: 2 },
        red: { persons: { given_name: 'Marie', family_name: 'D' } },
        blue: { persons: { given_name: 'Jean', family_name: 'P' } },
      }),
    ];
    const [row] = assembleBoardRows(input);
    expect(row!.currentMatch).toMatchObject({
      id: 'm1',
      redFighterName: 'Marie D',
      blueFighterName: 'Jean P',
      redScore: 3,
      blueScore: 2,
      status: 'running',
      round: 2,
      referees: [],
    });
  });

  it('names every bout by its code, never by its stored label', () => {
    const input = base();
    const pool = (id: string, status: string, label: string, scheduledAt: string | null) =>
      match({
        id,
        status,
        match_number_label: label,
        scheduled_at: scheduledAt,
        pools: { name: 'Pool 4', sort_order: 3 },
        phases: {
          type: 'pool',
          config_json: null,
          tournaments: { name: 'T', weapon: 'longsword' },
        },
      });
    input.matches = [
      pool('m1', 'running', 'L1-PD-M01', '2027-05-22T07:00:00Z'),
      pool('m2', 'scheduled', 'L1-PD-M02', '2027-05-22T07:06:00Z'),
    ];
    input.recentCompleted = [
      {
        id: 'm0',
        lice_id: 'L1',
        match_number_label: 'L1-PD-M00',
        scheduled_at: null,
        ended_at: '2027-05-22T06:59:00Z',
        phases: { config_json: null, tournaments: { weapon: 'longsword' } },
        pools: { sort_order: 3 },
      },
    ];
    const [row] = assembleBoardRows(input);
    expect(row!.currentMatch?.roundCode).toBe('LSW-P4-M01');
    expect(row!.nextUp?.label).toBe('LSW-P4-M02');
    expect(row!.queue.map((q) => q.label)).toEqual(['LSW-P4-M02']);
    expect(row!.lastCompleted?.label).toBe('LSW-P4-M00');
    expect(JSON.stringify(row)).not.toMatch(/L1-PD/);
  });

  it('reads the round from swiss_rounds for a Swiss bout', () => {
    // staff.service.ts has selected swiss_rounds(round_number) since the Swiss
    // schema landed, but nothing read it — Swiss rows showed no round at all.
    const input = base();
    input.matches = [match({ bracket_slots: null, swiss_rounds: { round_number: 3 } })];
    expect(assembleBoardRows(input)[0]!.currentMatch?.round).toBe(3);
  });

  it('is idle (currentMatch null) when the lice has no running/scheduled match', () => {
    expect(assembleBoardRows(base())[0]!.currentMatch).toBeNull();
  });

  it('sets nextUp to the first scheduled match that is not current', () => {
    const input = base();
    input.matches = [
      match({ id: 'm1', status: 'running' }),
      match({ id: 'm2', status: 'scheduled' }),
    ];
    expect(assembleBoardRows(input)[0]!.nextUp?.matchId).toBe('m2');
  });

  it('joins the assigned scorer, most-recently-seen first, with the peers', () => {
    const input = base();
    input.accounts = [
      account({ id: 'a1', display_name: 'Léa', last_seen_at: '2026-07-21T10:00:02Z' }),
      account({
        id: 'a2',
        display_name: 'Tom',
        username: 'tom',
        last_seen_at: '2026-07-21T09:00:00Z',
      }),
    ];
    input.assignments = [
      { staff_account_id: 'a1', lice_id: 'L1' },
      { staff_account_id: 'a2', lice_id: 'L1' },
    ];
    const [row] = assembleBoardRows(input);
    expect(row!.scorer).toEqual({
      accountId: 'a1',
      name: 'Léa',
      username: 'lea',
      status: 'active',
      lastSeenAt: '2026-07-21T10:00:02Z',
      otherCount: 1,
      others: [{ accountId: 'a2', name: 'Tom', lastSeenAt: '2026-07-21T09:00:00Z' }],
    });
  });

  it('keeps otherCount equal to others.length', () => {
    const input = base();
    input.accounts = [account({ id: 'a1' }), account({ id: 'a2' }), account({ id: 'a3' })];
    input.assignments = ['a1', 'a2', 'a3'].map((id) => ({ staff_account_id: id, lice_id: 'L1' }));
    const scorer = assembleBoardRows(input)[0]!.scorer!;
    expect(scorer.otherCount).toBe(scorer.others.length);
    expect(scorer.otherCount).toBe(2);
  });

  it('reports health UNKNOWN (null) when no metric has been reported', () => {
    const input = base();
    input.accounts = [
      account({ outbox_depth: null, oldest_pending_age_seconds: null, rejected_count: null }),
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    expect(assembleBoardRows(input)[0]!.health).toBeNull();
  });

  it('surfaces the attention flag + reason', () => {
    const input = base();
    input.accounts = [
      account({
        display_name: 'Ana',
        outbox_depth: 8,
        oldest_pending_age_seconds: 300,
        rejected_count: 2,
        needs_attention: true,
        needs_attention_reason: 'medic',
      }),
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    const [row] = assembleBoardRows(input);
    expect(row!.attention).toEqual({ reason: 'medic' });
    expect(row!.health).toEqual({
      outboxDepth: 8,
      oldestPendingAgeSec: 300,
      rejectedCount: 2,
      clockSkewMs: null,
    });
  });

  it('has a null scorer when no account is assigned to the lice', () => {
    expect(assembleBoardRows(base())[0]!.scorer).toBeNull();
  });
});
