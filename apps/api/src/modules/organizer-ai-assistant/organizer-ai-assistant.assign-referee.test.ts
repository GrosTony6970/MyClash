/**
 * The assistant's `assign_referee` apply asks what every referee write door asks
 * (ADR-016, W1.2) — and never confirms (W1 ruling 3): the organiser assigns by hand to go
 * ahead over a Discouraged reason.
 *
 * The board's judge is doubled and its CALL asserted; what it answers on a real Pool is
 * `assignment-board.judge-write.test.ts`'s.
 */
import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import {
  chain,
  mockSupabaseFrom,
  refereeBoard,
  resetHarness,
  service,
  type Chain,
} from './organizer-ai-assistant.harness';

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

/** The Match's Event, awaited after `.in()`. */
function matchRead(eventId: string) {
  const rows = [{ id: 'm-1', phases: { tournaments: { event_id: eventId } } }];
  const read = Object.assign(Promise.resolve({ data: rows, error: null }), {
    select: vi.fn(() => read),
    in: vi.fn(() => read),
  });
  return read;
}

const draft = (action: Record<string, unknown>) =>
  chain({
    data: {
      id: 'draft-1',
      event_id: 'event-1',
      actor_user_id: 'user-1',
      draft_type: 'referee_assignments',
      status: 'ready',
      proposed_actions_json: [
        { kind: 'assign_referee', userId: 'p-1', role: 'referee', ...action },
      ],
      events: { organization_id: 'org-1' },
    },
    error: null,
  });

/**
 * Routes the assistant's reads: the first `referee_assignments` read is the lock (a seeded
 * table, so its filters decide), the next is the insert.
 */
function route(action: Record<string, unknown>, locked = false) {
  const lock = mockSupabase({
    referee_assignments: {
      rows: locked
        ? [{ id: 'ra-0', event_id: 'event-1', status: 'confirmed', scope_type: 'pool' }]
        : [],
    },
  });
  const insert = chain({ data: { id: 'ra-1' }, error: null });
  const drafts = draft(action);
  let assignmentReads = 0;
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'matches') return matchRead('event-1');
    if (table === 'pools') {
      return chain({ data: { id: 'pool-1', phases: { tournaments: { event_id: 'event-1' } } } });
    }
    if (table === 'referee_assignments') {
      return assignmentReads++ === 0 ? lock.from(table) : insert;
    }
    if (table === 'organizer_ai_assistant_drafts') return drafts;
    return chain();
  });
  return { insert, drafts };
}

const insertedRow = (insert: Chain) => insert.insert.mock.calls[0]?.[0] as Record<string, unknown>;

describe('the assistant assigns a referee only past the checker (ADR-016)', () => {
  beforeEach(() => resetHarness());

  it('asks about the bout, never confirming, and stores what was confirmed over', async () => {
    const { insert } = route({ matchId: 'm-1' });

    await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(refereeBoard.judgeWrite).toHaveBeenCalledWith('event-1', {
      matchIds: ['m-1'],
      role: 'referee',
      personId: 'p-1',
      confirm: false,
    });
    expect(insertedRow(insert)).toMatchObject({
      person_id: 'p-1',
      scope_type: 'match',
      match_id: 'm-1',
      pool_id: null,
      role: 'referee',
      conflicts_jsonb: [],
    });
  });

  it('asks about a whole Pool as the board does', async () => {
    route({ poolId: 'pool-1' });

    await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(refereeBoard.judgeWrite).toHaveBeenCalledWith('event-1', {
      poolId: 'pool-1',
      role: 'referee',
      personId: 'p-1',
      confirm: false,
    });
  });

  it('a refusal writes nothing, and the failed draft keeps the reasons', async () => {
    const { insert, drafts } = route({ matchId: 'm-1' });
    refereeBoard.judgeWrite.mockRejectedValueOnce(
      new ConflictException({
        code: 'referee_needs_confirmation',
        message: 'Assigning this referee needs confirmation: own_pool (Longsword · Pool A)',
      }),
    );

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(insert.insert).not.toHaveBeenCalled();
    expect(drafts.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error:
          'Partially applied 0/1 action(s) before failing: Assigning this referee needs confirmation: own_pool (Longsword · Pool A)',
      }),
    );
  });

  it('on a locked board it is 409 referee_board_locked, and nothing is judged or written', async () => {
    const { insert } = route({ matchId: 'm-1' }, true);

    const error = await service()
      .applyDraft('event-1', 'draft-1', 'user-1')
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
    expect(refereeBoard.judgeWrite).not.toHaveBeenCalled();
    expect(insert.insert).not.toHaveBeenCalled();
  });
});
