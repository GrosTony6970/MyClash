import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { asSupabase as as, FIELD_OF_FOUR, fieldOf, readState } from './swiss.fixtures';
import { SwissPairingService } from './swiss-pairing.service';
import { SWISS_FIELD_CHANGED } from './swiss-commit';
import { rulesOf, withStampedRules } from '../phases/match-rules.fixtures';

type Answer = { data: unknown; error: { code?: string; message: string } | null };

const COMMITTED: Answer = {
  data: { status: 'committed', roundId: 'sr1', matchIds: ['m1', 'm2'] },
  error: null,
};

/** The tables a commit reads on top of the ones a plan reads: the event's pistes. */
const commitState = (over: Record<string, unknown> = {}) => ({
  ...readState(),
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

/** A double of the database: the plan's tables, the stamp, and `swiss_commit_round`'s answers. */
function commitDb(
  answers: Answer | ((args: Record<string, unknown>) => Answer) = COMMITTED,
  over: Record<string, unknown> = {},
) {
  const [tables, functions] = withStampedRules(commitState(over));
  return mockSupabase(tables, {
    ...functions,
    swiss_commit_round: typeof answers === 'function' ? answers : () => answers,
  });
}

/** The payloads `swiss_commit_round` was called with. */
const commits = (supabase: ReturnType<typeof commitDb>) =>
  supabase.rpc.mock.calls
    .filter(([name]) => name === 'swiss_commit_round')
    .map(([, args]) => args as Record<string, unknown>);

const collaborators = () => ({
  programme: { scheduleGroupUnchecked: vi.fn(async () => ({})) },
  notifications: { swissRoundPublished: vi.fn(async () => {}) },
});

function serviceOver(supabase: ReturnType<typeof commitDb>) {
  const { programme, notifications } = collaborators();
  const service = new SwissPairingService(
    as(supabase),
    programme as never,
    undefined as never,
    notifications as never,
  );
  return { service, programme, notifications };
}

describe('SwissPairingService — committing a round', () => {
  it('writes the round and its bouts in one call, and hands them to the programme', async () => {
    const supabase = commitDb();
    const { service, programme, notifications } = serviceOver(supabase);

    const committed = await service.commitNextRound('p1');

    expect(committed).toEqual({ roundId: 'sr1', roundNumber: 1 });
    const [payload] = commits(supabase);
    // The keys the function is last defined with (0243): a renamed key is a call to nothing.
    expect(Object.keys(payload!).sort()).toEqual(lastFunctionParams('swiss_commit_round').sort());
    expect(payload).toMatchObject({ p_phase: 'p1', p_round: 1, p_bye: null });
    // The field the plan was drawn from: p1's four, never the other phase's.
    expect([...(payload!['p_field'] as string[])].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    const bouts = payload!['p_bouts'] as SupabaseRow[];
    expect(bouts.map((row) => row['match_number_label'])).toEqual(['SW-R1-M1', 'SW-R1-M2']);
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

  // A withdraw between the plan and the write (the race, 0243): the database answers 'stale'
  // and the round is planned again from the field as it is now.
  it('plans the round again when the field changed under it', async () => {
    const entrants = fieldOf(4);
    const supabase = commitDb(
      vi
        .fn<(args: Record<string, unknown>) => Answer>()
        .mockImplementationOnce(() => {
          // The withdraw that landed meanwhile, as the next plan reads it.
          entrants[3]!['withdrawn_at_round'] = 1;
          return { data: { status: 'stale' }, error: null };
        })
        .mockImplementationOnce(() => COMMITTED),
      { swiss_entrants: { rows: entrants } },
    );
    const { service } = serviceOver(supabase);

    await expect(service.commitNextRound('p1')).resolves.toEqual({
      roundId: 'sr1',
      roundNumber: 1,
    });
    const [first, second] = commits(supabase);
    expect([...(first!['p_field'] as string[])].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect([...(second!['p_field'] as string[])].sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('gives up with a coded 409 on a field that changes plan after plan', async () => {
    const supabase = commitDb({ data: { status: 'stale' }, error: null });
    const { service, programme } = serviceOver(supabase);

    const refused = await service.commitNextRound('p1').catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({
      code: SWISS_FIELD_CHANGED,
    });
    expect(commits(supabase)).toHaveLength(3);
    expect(programme.scheduleGroupUnchecked).not.toHaveBeenCalled();
  });

  // The round read its stamp; the Tournament's rules may change before its bouts are in (R3).
  // The database re-stamps the bouts not started, so the round asks for the stamp again once its
  // bouts are written.
  it('re-stamps its bouts with the ruleset in force once they are in', async () => {
    const supabase = commitDb();
    const { service } = serviceOver(supabase);

    await service.commitNextRound('p1');

    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
      'stamp_match_rules',
      'swiss_commit_round',
      'stamp_match_rules',
    ]);
  });

  // Read before the write: a stamp that cannot be read writes no round.
  it('writes no round when the ruleset of its bouts cannot be read', async () => {
    const [tables] = withStampedRules(commitState());
    const supabase = mockSupabase(tables, {
      stamp_match_rules: () => ({ data: null, error: { message: 'connection reset' } }),
      swiss_commit_round: () => COMMITTED,
    });
    const { service } = serviceOver(supabase as ReturnType<typeof commitDb>);

    await expect(service.commitNextRound('p1')).rejects.toThrow(/was not read: connection reset/);
    expect(commits(supabase as ReturnType<typeof commitDb>)).toEqual([]);
  });

  it('sends the bye and the draw order the later rounds break ties on', async () => {
    // Three Fighters: one sits the round out. Round 1's `ranked` is read back by every later
    // plan (`seedOrderOf`), so it is written with the round.
    const supabase = commitDb(COMMITTED, { swiss_entrants: { rows: fieldOf(3) } });
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    const [payload] = commits(supabase);
    const [bout] = payload!['p_bouts'] as SupabaseRow[];
    const paired = [bout!['red_registration_id'], bout!['blue_registration_id']];
    const bye = payload!['p_bye'];
    expect(['r1', 'r2', 'r3']).toContain(bye);
    expect(paired).not.toContain(bye);
    expect(payload!['p_meta']).toMatchObject({ ranked: paired, manualAdjustments: [] });
  });

  it('numbers the boards so a plain text sort is bout order', async () => {
    // Twenty fighters is ten boards, which is where the zero starts to matter.
    // `listByPhase` and the schedule grid both order by `match_number_label` in
    // SQL, and Postgres sorts that column as TEXT — so an unpadded board 10
    // came back between board 1 and board 2.
    const supabase = commitDb(COMMITTED, { swiss_entrants: { rows: fieldOf(20) } });
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    const bouts = commits(supabase)[0]!['p_bouts'] as SupabaseRow[];
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
    const supabase = commitDb();
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    for (const bout of commits(supabase)[0]!['p_bouts'] as SupabaseRow[]) {
      expect(bout).toMatchObject({ match_rules_id: rulesOf('t1') });
      // The copy holds the pair; the bout's row carries none of its own.
      expect(bout).not.toHaveProperty('ruleset_code');
      expect(bout).not.toHaveProperty('ruleset_version');
      expect(bout).not.toHaveProperty('ruleset_content_hash');
    }
  });

  it('treats a round another completion already committed as a no-op', async () => {
    // Two bouts of the same round finishing at the same instant both see
    // "round complete" and both commit. The round exists either way — which
    // is all the caller wanted.
    const supabase = commitDb({ data: { status: 'exists', roundId: 'sr0' }, error: null });
    const { service, programme, notifications } = serviceOver(supabase);

    await expect(service.commitNextRound('p1')).resolves.toBeNull();
    // Nor scheduled or announced again by a call that did not write it.
    expect(programme.scheduleGroupUnchecked).not.toHaveBeenCalled();
    expect(notifications.swissRoundPublished).not.toHaveBeenCalled();
  });

  it('refuses an answer that says nothing', async () => {
    const supabase = commitDb({ data: null, error: null });
    const service = new SwissPairingService(as(supabase));

    await expect(service.commitNextRound('p1')).rejects.toThrow(/was answered nothing/);
  });

  it('surfaces a failed write', async () => {
    const supabase = commitDb({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const service = new SwissPairingService(as(supabase));

    await expect(service.commitNextRound('p1')).rejects.toThrow(BadRequestException);
  });

  it('keeps the round when scheduling it fails', async () => {
    // This runs inside match completion, which must never throw. An unscheduled
    // round can be placed from the schedule grid; an unpaired one cannot be
    // recovered at all.
    const supabase = commitDb();
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
    // And the field is still told the round exists.
    expect(notifications.swissRoundPublished).toHaveBeenCalledWith('sr1');
  });

  it('keeps the round when announcing it fails', async () => {
    const supabase = commitDb();
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
    const supabase = commitDb(COMMITTED, {
      lices: { rows: [{ id: 'lice-z', event_id: 'e2', sort_order: 1 }] },
    });
    const { programme } = collaborators();
    const service = new SwissPairingService(as(supabase), programme as never);

    await expect(service.commitNextRound('p1')).resolves.toEqual({
      roundId: 'sr1',
      roundNumber: 1,
    });
    expect(programme.scheduleGroupUnchecked).not.toHaveBeenCalled();
  });

  it('plans from the active field only', async () => {
    // A Fighter withdrawn before round 1 is not in the field the write re-checks.
    const supabase = commitDb(COMMITTED, {
      swiss_entrants: {
        rows: FIELD_OF_FOUR.map((row) =>
          row['registration_id'] === 'r2' ? { ...row, withdrawn_at_round: 1 } : row,
        ),
      },
    });
    const service = new SwissPairingService(as(supabase));

    await service.commitNextRound('p1');

    expect([...(commits(supabase)[0]!['p_field'] as string[])].sort()).toEqual(['r1', 'r3', 'r4']);
  });
});
