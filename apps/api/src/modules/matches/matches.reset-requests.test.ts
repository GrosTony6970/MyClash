import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * A reset voids every hit of its bout, so it ends the requests that wait on
 * them: a finished bout and a bout still running alike (ruling 260).
 *
 * The un-completion owner used to close them, and it runs for a FINISHED bout
 * only. A reset of a running bout voided the hits and closed nothing: a waiting
 * "restore this hit" request still worked, and put a hit back into an empty bout.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000004';
const CLOSED = [{ id: 'request-1' }];
const RESET = { confirmation: 'RESET MATCH', reason: 'replay the bout' };

function setup(status: string, over: Record<string, TableSeed> = {}) {
  const supabase = mockSupabase({
    matches: { rows: [{ id: 'match-1', locked_at: null, status }] },
    exchanges: { rows: [] },
    match_penalties: { rows: [] },
    match_events: { rows: [] },
    ...over,
  });
  /** What the reset had written when each step of the guard ran. */
  const seen = { atClose: [] as string[], atTelling: [] as string[] };
  const written = () => supabase.writes.map((write) => write.table);
  const frozen = {
    rejectPendingEditsForMatch: vi.fn(() => {
      seen.atClose = written();
      return Promise.resolve(CLOSED);
    }),
    tellClosedByReset: vi.fn(() => {
      seen.atTelling = written();
      return Promise.resolve();
    }),
  };
  const completion = { onMatchUncompleted: vi.fn().mockResolvedValue(undefined) };
  const service = new MatchesService(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    frozen as never,
    completion as never,
  );
  return { service, supabase, frozen, completion, seen };
}

describe('a reset ends the requests that wait on its hits (ruling 260)', () => {
  it.each(['running', 'completed', 'scheduled'])(
    'a %s bout: its requests are closed in the name of who reset it',
    async (status) => {
      const s = setup(status);

      await s.service.resetMatch('match-1', RESET, { userId: ORGANISER });

      expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([[['match-1'], ORGANISER]]);
    },
  );

  it('a pad’s reset names no account', async () => {
    const s = setup('running');

    await s.service.resetMatch('match-1', RESET, { staffAccountId: 'pad-1' });

    expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([[['match-1'], undefined]]);
  });

  it('the close runs once the hits are voided, and the telling after the last write', async () => {
    const s = setup('running');

    await s.service.resetMatch('match-1', RESET, { userId: ORGANISER });

    expect(s.seen.atClose).toEqual(['exchanges']);
    expect(s.seen.atTelling).toEqual(['exchanges', 'match_penalties', 'match_events', 'matches']);
    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
  });

  it('hits that could not be voided still count: no request is closed', async () => {
    const s = setup('running', {
      exchanges: { data: null, error: { message: 'the database is away' } },
    });

    await expect(s.service.resetMatch('match-1', RESET, { userId: ORGANISER })).rejects.toThrow(
      BadRequestException,
    );

    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
    expect(s.frozen.tellClosedByReset).not.toHaveBeenCalled();
  });

  // The close is saved by then, and a second reset finds no request left to tell about.
  it('a later step that fails still tells who asked: their requests are closed', async () => {
    const s = setup('running', {
      match_events: [
        { data: null, error: null },
        { data: null, error: { message: 'sequence conflict' } },
      ],
    });

    await expect(s.service.resetMatch('match-1', RESET, { userId: ORGANISER })).rejects.toThrow(
      'sequence conflict',
    );

    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
  });

  it('a reset the un-completion owner refuses closes nothing: the hits stay', async () => {
    const s = setup('completed');
    s.completion.onMatchUncompleted.mockRejectedValue(new BadRequestException('a later bout'));

    await expect(s.service.resetMatch('match-1', RESET, { userId: ORGANISER })).rejects.toThrow(
      'a later bout',
    );

    expect(writesTo(s.supabase, 'exchanges')).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
    expect(s.frozen.tellClosedByReset).not.toHaveBeenCalled();
  });
});
