import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { asSupabase as as, fieldOf, readState } from './swiss.fixtures';
import { SwissPairingService } from './swiss-pairing.service';

/** The tables a commit writes to, on top of the ones a plan reads. */
const commitState = (over: Record<string, unknown> = {}) => ({
  ...readState(),
  swiss_rounds: { rows: [] as SupabaseRow[], returning: { id: 'sr1' } },
  matches: {
    rows: [] as SupabaseRow[],
    returning: (_row: SupabaseRow, index: number) => ({ id: `m${index + 1}` }),
  },
  lices: {
    rows: [
      // Deliberately seeded out of order: the piste order is the one the
      // organiser set, not the one the rows came back in.
      { id: 'lice-b', event_id: 'e1', sort_order: 2 },
      { id: 'lice-a', event_id: 'e1', sort_order: 1 },
      // Another event's piste. A round must never be scheduled onto it.
      { id: 'lice-z', event_id: 'e2', sort_order: 1 },
    ],
  },
  ...over,
});

const collaborators = () => ({
  programme: { scheduleGroupUnchecked: vi.fn(async () => ({})) },
  notifications: { swissRoundPublished: vi.fn(async () => {}) },
});

describe('SwissPairingService — committing a round', () => {
  it('writes the round, its bouts, and hands them to the programme', async () => {
    const supabase = mockSupabase(commitState());
    const { programme, notifications } = collaborators();
    const service = new SwissPairingService(
      as(supabase),
      programme as never,
      undefined as never,
      notifications as never,
    );

    const committed = await service.commitNextRound('p1');

    expect(committed).toEqual({ roundId: 'sr1', roundNumber: 1 });
    expect(writesTo(supabase, 'swiss_rounds')[0]?.row).toMatchObject({
      phase_id: 'p1',
      round_number: 1,
      status: 'pending',
      bye_registration_id: null,
    });

    const bouts = writesTo(supabase, 'matches')[0]?.row as SupabaseRow[];
    expect(bouts).toHaveLength(2);
    expect(bouts.map((row) => row['match_number_label'])).toEqual(['SW-R1-M1', 'SW-R1-M2']);
    expect(bouts.every((row) => row['swiss_round_id'] === 'sr1')).toBe(true);
    expect(bouts.every((row) => row['status'] === 'scheduled')).toBe(true);

    // Scheduled onto this event's pistes, in the order the organiser set them,
    // and never onto the other event's.
    expect(programme.scheduleGroupUnchecked).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        matchIds: ['m1', 'm2'],
        liceIds: ['lice-a', 'lice-b'],
        mode: 'pool',
      }),
    );
    // Announced last, so the message can name the piste.
    expect(notifications.swissRoundPublished).toHaveBeenCalledWith('sr1');
    expect(notifications.swissRoundPublished.mock.invocationCallOrder[0]).toBeGreaterThan(
      programme.scheduleGroupUnchecked.mock.invocationCallOrder[0] as number,
    );
  });

  it('numbers the boards so a plain text sort is bout order', async () => {
    // Twenty fighters is ten boards, which is where the zero starts to matter.
    // `listByPhase` and the schedule grid both order by `match_number_label` in
    // SQL, and Postgres sorts that column as TEXT — so an unpadded board 10
    // came back between board 1 and board 2.
    const supabase = mockSupabase(commitState({ swiss_entrants: { rows: fieldOf(20) } }));
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    const bouts = writesTo(supabase, 'matches')[0]?.row as SupabaseRow[];
    const labels = bouts.map((row) => row['match_number_label'] as string);

    expect(labels).toHaveLength(10);
    // The property the two SQL reads depend on, asserted rather than the
    // spelling: sorted as plain text, the labels are in board order.
    expect([...labels].sort()).toEqual(labels);
    expect(labels[0]).toBe('SW-R1-M01');
    expect(labels.at(-1)).toBe('SW-R1-M10');
  });

  it('stamps the tournament’s own ruleset on every bout it generates', async () => {
    // Generation used to hardcode TF_v1, so a tournament scored by another
    // engine had its bouts stamped with one engine and its standings computed
    // with another.
    const supabase = mockSupabase(commitState());
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    const bouts = writesTo(supabase, 'matches')[0]?.row as SupabaseRow[];
    for (const bout of bouts) {
      expect(bout).toMatchObject({
        ruleset_code: 'Generic_PointsCap',
        // Canonicalised on the way in — the column holds the shorthand '1'.
        ruleset_version: '1.0.0',
        ruleset_content_hash: 'hash-1',
      });
    }
  });

  it('treats a round another completion already committed as a no-op', async () => {
    // Two bouts of the same round finishing at the same instant both see
    // "round complete" and both commit. The unique index makes the loser a
    // 23505, and the round exists either way — which is all the caller wanted.
    const supabase = mockSupabase(
      commitState({
        swiss_rounds: [
          { data: [], error: null },
          { data: null, error: { code: '23505', message: 'duplicate key value violates …' } },
        ],
      }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.commitNextRound('p1')).resolves.toBeNull();
    // And no bouts were written for a round this call did not create.
    expect(writesTo(supabase, 'matches')).toHaveLength(0);
  });

  it('surfaces any other insert failure', async () => {
    const supabase = mockSupabase(
      commitState({
        swiss_rounds: [
          { data: [], error: null },
          { data: null, error: { code: '42501', message: 'permission denied' } },
        ],
      }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.commitNextRound('p1')).rejects.toThrow(BadRequestException);
  });

  it('keeps the round when scheduling it fails', async () => {
    // This runs inside match completion, which must never throw. An unscheduled
    // round can be placed from the schedule grid; an unpaired one cannot be
    // recovered at all.
    const supabase = mockSupabase(commitState());
    const { notifications } = collaborators();
    const programme = {
      scheduleGroupUnchecked: vi.fn(async () => {
        throw new Error('no piste free');
      }),
    };
    const service = new SwissPairingService(
      as(supabase),
      programme as never,
      undefined as never,
      notifications as never,
    );

    await expect(service.commitNextRound('p1')).resolves.toEqual({
      roundId: 'sr1',
      roundNumber: 1,
    });
    expect(writesTo(supabase, 'matches')).toHaveLength(1);
    // And the field is still told the round exists.
    expect(notifications.swissRoundPublished).toHaveBeenCalledWith('sr1');
  });

  it('keeps the round when announcing it fails', async () => {
    const supabase = mockSupabase(commitState());
    const { programme } = collaborators();
    const notifications = {
      swissRoundPublished: vi.fn(async () => {
        throw new Error('mail is down');
      }),
    };
    const service = new SwissPairingService(
      as(supabase),
      programme as never,
      undefined as never,
      notifications as never,
    );

    await expect(service.commitNextRound('p1')).resolves.toEqual({
      roundId: 'sr1',
      roundNumber: 1,
    });
    expect(programme.scheduleGroupUnchecked).toHaveBeenCalled();
  });

  it('leaves the round unscheduled when the event has no pistes', async () => {
    const supabase = mockSupabase(
      commitState({ lices: { rows: [{ id: 'lice-z', event_id: 'e2', sort_order: 1 }] } }),
    );
    const { programme } = collaborators();
    const service = new SwissPairingService(as(supabase), programme as never);

    await expect(service.commitNextRound('p1')).resolves.toEqual({
      roundId: 'sr1',
      roundNumber: 1,
    });
    expect(programme.scheduleGroupUnchecked).not.toHaveBeenCalled();
  });
});
