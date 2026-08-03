// apps/api/src/modules/staff/live-board.test.ts
import { describe, expect, it } from 'vitest';
import { assembleBoardRows, type AssembleInput } from './live-board';

function base(): AssembleInput {
  return {
    lices: [{ id: 'L1', name: 'Piste 1', sort_order: 0 }],
    matches: [],
    accounts: [],
    assignments: [],
  };
}

describe('assembleBoardRows', () => {
  it('picks a running match as current and maps score + fighters', () => {
    const input = base();
    input.matches = [
      {
        id: 'm1',
        lice_id: 'L1',
        status: 'running',
        red_score: 3,
        blue_score: 2,
        match_number_label: '#3',
        bracket_slots: { round: 2 },
        red: { persons: { given_name: 'Marie', family_name: 'D' } },
        blue: { persons: { given_name: 'Jean', family_name: 'P' } },
      },
    ];
    const [row] = assembleBoardRows(input);
    expect(row!.currentMatch).toEqual({
      id: 'm1',
      redFighterName: 'Marie D',
      blueFighterName: 'Jean P',
      redScore: 3,
      blueScore: 2,
      status: 'running',
      round: 2,
    });
  });

  it('reads the round from swiss_rounds for a Swiss bout', () => {
    // staff.service.ts has selected swiss_rounds(round_number) since the Swiss
    // schema landed, but nothing read it — Swiss rows showed no round at all.
    const input = base();
    input.matches = [
      {
        id: 'm1',
        lice_id: 'L1',
        status: 'running',
        red_score: 0,
        blue_score: 0,
        match_number_label: 'SW-R3-M2',
        bracket_slots: null,
        swiss_rounds: { round_number: 3 },
        red: { persons: { given_name: 'Marie', family_name: 'D' } },
        blue: { persons: { given_name: 'Jean', family_name: 'P' } },
      },
    ];
    expect(assembleBoardRows(input)[0]!.currentMatch?.round).toBe(3);
  });

  it('is idle (currentMatch null) when the lice has no running/scheduled match', () => {
    expect(assembleBoardRows(base())[0]!.currentMatch).toBeNull();
  });

  it('sets nextUp to the first scheduled match that is not current', () => {
    const input = base();
    input.matches = [
      {
        id: 'm1',
        lice_id: 'L1',
        status: 'running',
        red_score: 0,
        blue_score: 0,
        match_number_label: '#1',
        bracket_slots: null,
        red: null,
        blue: null,
      },
      {
        id: 'm2',
        lice_id: 'L1',
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
        match_number_label: '#2',
        bracket_slots: null,
        red: null,
        blue: null,
      },
    ];
    expect(assembleBoardRows(input)[0]!.nextUp).toEqual({ matchId: 'm2', label: '#2' });
  });

  it('joins the assigned scorer, most-recently-seen first, with otherCount', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Léa',
        last_seen_at: '2026-07-21T10:00:02Z',
        outbox_depth: 0,
        oldest_pending_age_seconds: 0,
        rejected_count: 0,
        needs_attention: false,
        needs_attention_reason: null,
      },
      {
        id: 'a2',
        display_name: 'Tom',
        last_seen_at: '2026-07-21T09:00:00Z',
        outbox_depth: 0,
        oldest_pending_age_seconds: 0,
        rejected_count: 0,
        needs_attention: false,
        needs_attention_reason: null,
      },
    ];
    input.assignments = [
      { staff_account_id: 'a1', lice_id: 'L1' },
      { staff_account_id: 'a2', lice_id: 'L1' },
    ];
    const [row] = assembleBoardRows(input);
    expect(row!.scorer).toEqual({
      accountId: 'a1',
      name: 'Léa',
      lastSeenAt: '2026-07-21T10:00:02Z',
      otherCount: 1,
    });
  });

  it('reports health UNKNOWN (null) when no metric has been reported', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Léa',
        last_seen_at: '2026-07-21T10:00:02Z',
        outbox_depth: null,
        oldest_pending_age_seconds: null,
        rejected_count: null,
        needs_attention: false,
        needs_attention_reason: null,
      },
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    expect(assembleBoardRows(input)[0]!.health).toBeNull();
  });

  it('surfaces the attention flag + reason', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Ana',
        last_seen_at: null,
        outbox_depth: 8,
        oldest_pending_age_seconds: 300,
        rejected_count: 2,
        needs_attention: true,
        needs_attention_reason: 'medic',
      },
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    const [row] = assembleBoardRows(input);
    expect(row!.attention).toEqual({ reason: 'medic' });
    expect(row!.health).toEqual({ outboxDepth: 8, oldestPendingAgeSec: 300, rejectedCount: 2 });
  });

  it('has a null scorer when no account is assigned to the lice', () => {
    expect(assembleBoardRows(base())[0]!.scorer).toBeNull();
  });
});
