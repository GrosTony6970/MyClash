import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';

/**
 * A bout put back on the schedule ends the requests that wait on its hits, and
 * tells who asked (ruling 257).
 *
 * Léa asks to void a hit of an over Event. The Event is set back to running,
 * and an organiser resets the bout: every hit of it is voided. Her request was
 * closed as rejected with an English reason, and she was told nothing.
 */
const LEA = 'a0000000-0000-4000-8000-000000000002';
const PAUL = 'a0000000-0000-4000-8000-000000000003';
const ORGANISER = 'a0000000-0000-4000-8000-000000000004';
const BOUT_RESET =
  'Ce combat a été rouvert : votre demande est close. Refaites-la si un échange est toujours faux. / This bout was reopened, so your request was closed. Ask again if an exchange is still wrong.';

const request = (id: string, matchId: string, asker: string, status = 'pending') => ({
  id,
  event_id: 'event-1',
  match_id: matchId,
  exchange_id: `hit-of-${id}`,
  requested_by_user_id: asker,
  request_type: 'void_exchange',
  reason: 'the video shows no hit',
  status,
});

function setup(requests: 'seeded' | 'failing' = 'seeded') {
  const db = mockSupabase({
    exchange_edit_requests:
      requests === 'failing'
        ? { data: null, error: { message: 'the database is away' } }
        : {
            rows: [
              request('r-lea', 'm1', LEA),
              request('r-paul', 'm2', PAUL),
              // Decoys: another bout, and a request of this bout that is reviewed.
              request('r-other-bout', 'm9', LEA),
              request('r-reviewed', 'm1', LEA, 'approved'),
            ],
          },
  });
  const notifications = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
  const guard = new FrozenResultsGuard(db as never, notifications as never);
  return { db, notifications, guard };
}

const rejectedNotice = (requestId: string, userId: string) => ({
  kind: 'exchange_edit_rejected',
  entityId: requestId,
  userId,
  title: 'Demande de correction refusée / Exchange correction rejected',
  body: BOUT_RESET,
  url: '/notifications',
  preference: 'schedule_changes',
});

describe('a bout put back on the schedule ends its waiting requests (ruling 257)', () => {
  it('each request that waits is rejected with the fixed reason, in both languages', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    expect(writesTo(s.db, 'exchange_edit_requests')).toEqual([
      {
        table: 'exchange_edit_requests',
        op: 'update',
        row: {
          status: 'rejected',
          reviewed_by_user_id: ORGANISER,
          reviewed_at: expect.any(String),
          rejection_reason: BOUT_RESET,
          updated_at: expect.any(String),
        },
        filters: [
          { method: 'in', args: ['match_id', ['m1', 'm2']] },
          { method: 'eq', args: ['status', 'pending'] },
        ],
      },
    ]);
    // The notice needs who asked: the double ignores a projection.
    expect(selectsFor(s.db.from, 'exchange_edit_requests')).toEqual(['*']);
  });

  it('who asked is told why, once per request this call closed', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    expect(s.notifications.sendImmediate.mock.calls).toEqual([
      [rejectedNotice('r-lea', LEA)],
      [rejectedNotice('r-paul', PAUL)],
    ]);
  });

  it('a pad’s reset names no reviewer: a staff account is not an account', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch(['m1']);

    expect(writesTo(s.db, 'exchange_edit_requests')[0]?.row).toMatchObject({
      reviewed_by_user_id: null,
    });
    expect(s.notifications.sendImmediate.mock.calls).toEqual([[rejectedNotice('r-lea', LEA)]]);
  });

  it('no bout: nothing is read, written or told', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch([], ORGANISER);

    expect(s.db.from).not.toHaveBeenCalled();
    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });

  it('a close that fails does not fail the reset, which has landed, and tells nobody', async () => {
    const s = setup('failing');

    await expect(s.guard.rejectPendingEditsForMatch(['m1'], ORGANISER)).resolves.toBeUndefined();

    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });

  // The double throws on a table nobody seeded, as a client whose call rejects.
  it('a close that throws does not fail the reset either', async () => {
    const notifications = { sendImmediate: vi.fn() };
    const guard = new FrozenResultsGuard(mockSupabase({}) as never, notifications as never);

    await expect(guard.rejectPendingEditsForMatch(['m1'], ORGANISER)).resolves.toBeUndefined();

    expect(notifications.sendImmediate).not.toHaveBeenCalled();
  });

  it('a notice that fails does not fail the reset, and the next asker is still told', async () => {
    const s = setup();
    s.notifications.sendImmediate.mockRejectedValueOnce(new Error('the queue is away'));

    await expect(
      s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER),
    ).resolves.toBeUndefined();

    expect(s.notifications.sendImmediate).toHaveBeenCalledTimes(2);
  });
});
