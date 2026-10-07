import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * The status door (`PATCH /matches/:id/status`). No screen sends it today.
 *
 * Ruling 338: it never takes a bout out of completed. The clock's Reopen is the
 * one way back in play: it reads the sheet again, or puts the earlier score
 * back (rulings 331, 332), and this door did neither. Ruling 331: a bout it
 * sets running or paused carries no result.
 *
 * The double applies no write, so the refusal is pinned by the write's own
 * filter and by what the write hands back.
 */
const BOUT = 'm1';
const COMPLETED = {
  id: BOUT,
  status: 'completed',
  winner_registration_id: 'red',
  end_reason: 'forfeit',
  ended_at: '2026-04-25T09:01:00.000Z',
};
const SCHEDULED = {
  id: BOUT,
  status: 'scheduled',
  winner_registration_id: null,
  end_reason: null,
  ended_at: null,
};
const NOT_COMPLETED = { method: 'neq', args: ['status', 'completed'] };

function setup(bout: Record<string, unknown> = COMPLETED) {
  const db = mockSupabase({ matches: { rows: [bout] } });
  const completion = {
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
  };
  const scoring = { clockAction: vi.fn().mockResolvedValue({ status: 'halted' }) };
  const service = new MatchesService(
    db as never,
    scoring as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined,
    completion as never,
  );
  return { db, scoring, completion, service };
}

const NO_RESULT = { winner_registration_id: null, end_reason: null, ended_at: null };

describe('MatchesService.updateStatus: a completed bout stays completed (ruling 338)', () => {
  it.each<'running' | 'paused'>(['running', 'paused'])(
    'refuses to set it %s, and un-completes nothing',
    async (status) => {
      const { db, completion, service } = setup();

      await expect(service.updateStatus(BOUT, { status } as never)).rejects.toEqual(
        new ConflictException('Match is completed: reopen it from the clock'),
      );

      // The record, the bracket and the later bouts are left as they were.
      expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
      // In the write itself: a closing hit may land after any read of the status.
      const writes = writesTo(db, 'matches');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.filters).toContainEqual(NOT_COMPLETED);
      expect(writes[0]?.filters).toContainEqual({ method: 'eq', args: ['id', BOUT] });
    },
  );

  it('completed on a completed bout is still written, with no such filter', async () => {
    const { db, service } = setup();

    await service.updateStatus(BOUT, { status: 'completed' } as never);

    const [write] = writesTo(db, 'matches');
    expect(Object.keys(write?.row as Record<string, unknown>).sort()).toEqual([
      'ended_at',
      'status',
      'updated_at',
    ]);
    expect(write?.filters).not.toContainEqual(NOT_COMPLETED);
  });

  it('completed with a winner writes the winner, then hands off', async () => {
    const { db, completion, service } = setup(SCHEDULED);

    await service.updateStatus(BOUT, {
      status: 'completed',
      winnerRegistrationId: 'blue',
    } as never);

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({
      status: 'completed',
      winner_registration_id: 'blue',
    });
    expect(completion.onMatchCompleted.mock.calls).toEqual([[BOUT]]);
  });
});

describe('MatchesService.updateStatus: a bout set in play (ruling 331)', () => {
  it.each<'running' | 'paused'>(['running', 'paused'])(
    '%s on a bout that is not completed leaves no result',
    async (status) => {
      const { db, completion, service } = setup(SCHEDULED);

      await expect(service.updateStatus(BOUT, { status } as never)).resolves.toMatchObject({
        id: BOUT,
      });

      expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ status, ...NO_RESULT });
      expect(completion.onMatchUncompleted).not.toHaveBeenCalled();
    },
  );
});

describe('MatchesService.voidMatch', () => {
  it('a voided bout keeps the result it was voided with', async () => {
    const { db, service } = setup();

    await service.voidMatch(BOUT);

    const [write] = writesTo(db, 'matches');
    expect(Object.keys(write?.row as Record<string, unknown>).sort()).toEqual([
      'status',
      'updated_at',
    ]);
    expect(write?.filters).not.toContainEqual(NOT_COMPLETED);
  });

  it('still takes a completed bout out of what it fed, before the write', async () => {
    const { db, completion, service } = setup();
    const actor = { userId: 'u1' };
    const writesWhenAsked: number[] = [];
    completion.onMatchUncompleted.mockImplementation(
      async () => void writesWhenAsked.push(db.writes.length),
    );

    await service.voidMatch(BOUT, actor, true);

    expect(completion.onMatchUncompleted.mock.calls).toEqual([
      [BOUT, { actor, discardDependents: true, reason: 'match status set to voided' }],
    ]);
    expect(writesWhenAsked).toEqual([0]);
  });
});

describe('MatchesService.clockAction', () => {
  it('goes through the door that reads the sheet (ruling 331)', async () => {
    const { scoring, service } = setup();
    const actor = { userId: 'u1' };

    await expect(service.clockAction(BOUT, 'reopen', 'why', actor, true)).resolves.toEqual({
      status: 'halted',
    });

    expect(scoring.clockAction.mock.calls).toEqual([[BOUT, 'reopen', 'why', actor, true]]);
  });
});
