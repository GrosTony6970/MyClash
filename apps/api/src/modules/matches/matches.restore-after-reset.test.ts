import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * A hit from before its bout's last reset is not restored (ruling 275).
 *
 * A reset voids every hit of a bout so that it is fought again. The bout's page
 * still shows "Restore" on each of those hits. A restore would put an old hit
 * into a bout nobody has fought yet, and the score would count it.
 *
 * The rule is asked before the lock and before the over-Event review: nobody
 * restores such a hit, and nobody files a request to.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000004';
const BEFORE = '2026-10-05T09:00:00.000Z';
const RESET_AT = '2026-10-05T09:30:00.000Z';
const AFTER = '2026-10-05T09:45:00.000Z';

const reset = (sequence: number, occurredAt: string) => ({
  match_id: 'match-1',
  sequence,
  type: 'reset_match',
  occurred_at: occurredAt,
});

function setup(recordedAt: string, events: TableSeed) {
  const supabase = mockSupabase({
    exchanges: {
      rows: [
        { id: 'hit-1', match_id: 'match-1', voided: true, sequence: 3, recorded_at: recordedAt },
      ],
    },
    matches: { rows: [{ id: 'match-1', locked_at: null, status: 'scheduled' }] },
    match_events: events,
    audit_log: { rows: [] },
  });
  const scoring = {
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
    recomputeMatchScore: vi.fn().mockResolvedValue(undefined),
  };
  const frozen = {
    guardExchangeMutation: vi.fn().mockResolvedValue(null),
    closeAnswered: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MatchesService(
    supabase as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
    frozen as never,
  );
  return { service, supabase, scoring, frozen };
}

const refusal = async (attempt: Promise<unknown>) => {
  const thrown = await attempt.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(thrown).toBeInstanceOf(ConflictException);
  return (thrown as ConflictException).getResponse();
};

describe('a hit from before the last reset is not restored (ruling 275)', () => {
  it('refuses with a code, and writes nothing', async () => {
    const s = setup(BEFORE, { rows: [reset(4, RESET_AT)] });

    expect(await refusal(s.service.revertVoidExchange('hit-1', { userId: ORGANISER }))).toEqual({
      message: 'This exchange is from before the bout was reset. It cannot be restored.',
      code: 'exchange_from_before_reset',
    });

    expect(s.supabase.writes).toEqual([]);
    expect(s.scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  // On an over Event the review would file a request that nobody may approve.
  it('is asked before the review: no request is filed', async () => {
    const s = setup(BEFORE, { rows: [reset(4, RESET_AT)] });

    await refusal(s.service.revertVoidExchange('hit-1', { userId: ORGANISER }));

    expect(s.frozen.guardExchangeMutation).not.toHaveBeenCalled();
  });

  // A super admin's Approve reads the request, then restores: a reset can land between.
  it('refuses an approval alike', async () => {
    const s = setup(BEFORE, { rows: [reset(4, RESET_AT)] });
    const request = {
      id: 'request-1',
      exchange_id: 'hit-1',
      request_type: 'revert_void_exchange' as const,
      reason: 'it was a hit',
    };

    await refusal(s.service.approveFrozenExchangeEdit(request, ORGANISER));

    expect(writesTo(s.supabase, 'exchanges')).toEqual([]);
  });

  it('restores a hit saved after the reset', async () => {
    const s = setup(AFTER, { rows: [reset(4, RESET_AT)] });

    await s.service.revertVoidExchange('hit-1', { userId: ORGANISER });

    expect(writesTo(s.supabase, 'exchanges').map((write) => write.row)).toEqual([
      { voided: false, voided_reason: null },
    ]);
  });

  it('restores a hit of a bout that was never reset', async () => {
    const s = setup(BEFORE, { rows: [] });

    await s.service.revertVoidExchange('hit-1', { userId: ORGANISER });

    expect(writesTo(s.supabase, 'exchanges')).toHaveLength(1);
  });

  // The hit sits between two resets: the LAST one decides.
  it('reads the last reset, not the first', async () => {
    const s = setup(AFTER, {
      rows: [reset(4, RESET_AT), reset(9, '2026-10-05T10:00:00.000Z')],
    });

    await refusal(s.service.revertVoidExchange('hit-1', { userId: ORGANISER }));
  });

  // The reset voids the hits, then writes its line: both can carry one instant.
  it('a hit saved at the instant of the reset is from before it', async () => {
    const s = setup(RESET_AT, { rows: [reset(4, RESET_AT)] });

    await refusal(s.service.revertVoidExchange('hit-1', { userId: ORGANISER }));
  });

  it('asks for the reset lines of this bout only, newest first', async () => {
    const s = setup(AFTER, {
      rows: [
        reset(4, RESET_AT),
        // Another bout was reset later, and this bout's clock was reset later too.
        { ...reset(2, '2026-10-05T11:00:00.000Z'), match_id: 'match-2' },
        { ...reset(7, '2026-10-05T11:00:00.000Z'), type: 'reset_clock' },
      ],
    });

    await s.service.revertVoidExchange('hit-1', { userId: ORGANISER });

    expect(selectsFor(s.supabase.from, 'exchanges')[0]).toBe(
      'id, match_id, voided, sequence, recorded_at',
    );
    expect(selectsFor(s.supabase.from, 'match_events')).toEqual(['occurred_at']);
    expect(filtersFor(s.supabase.from, 'match_events', 'eq')).toEqual([
      ['match_id', 'match-1'],
      ['type', 'reset_match'],
    ]);
    expect(filtersFor(s.supabase.from, 'match_events', 'order')).toEqual([
      ['sequence', { ascending: false }],
    ]);
  });

  // A failed read is not "never reset": the hit would come back into the bout.
  it('a failed read of the resets is an error, not a restore', async () => {
    const s = setup(BEFORE, { data: null, error: { message: 'the database is away' } });

    const thrown = await s.service.revertVoidExchange('hit-1', { userId: ORGANISER }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ConflictException);
    expect((thrown as { getStatus?: unknown }).getStatus).toBeUndefined();
    expect(s.supabase.writes).toEqual([]);
  });
});
