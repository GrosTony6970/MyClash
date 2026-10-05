import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';

/**
 * A bout whose hits a reset voided ends the requests that wait on them, writes
 * each close in the audit trail, and tells who asked (rulings 257, 260, 274).
 *
 * Léa asks to void a hit of an over Event. The Event is set back to running,
 * and an organiser resets the bout: every hit of it is voided. Her request is
 * closed as rejected with one fixed reason, and she is told once the reset has
 * done its last step.
 */
const LEA = 'a0000000-0000-4000-8000-000000000002';
const PAUL = 'a0000000-0000-4000-8000-000000000003';
const ORGANISER = 'a0000000-0000-4000-8000-000000000004';
const BOUT_RESET =
  'Ce combat a été remis à zéro et sera rejoué : votre demande est close. / This bout was reset and will be fought again, so your request was closed.';

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

const R_LEA = request('r-lea', 'm1', LEA);
const R_PAUL = request('r-paul', 'm2', PAUL);

function setup(
  requests: 'seeded' | 'failing' = 'seeded',
  audit: 'kept' | 'failing' | 'throwing' = 'kept',
) {
  const db = mockSupabase({
    exchange_edit_requests:
      requests === 'failing'
        ? { data: null, error: { message: 'the database is away' } }
        : {
            rows: [
              R_LEA,
              R_PAUL,
              // Decoys: another bout, and a request of this bout that is reviewed.
              request('r-other-bout', 'm9', LEA),
              request('r-reviewed', 'm1', LEA, 'approved'),
            ],
          },
    // The double throws on a table nobody seeded, as a client whose call rejects.
    ...(audit === 'throwing'
      ? {}
      : {
          audit_log:
            audit === 'failing'
              ? { data: null, error: { message: 'the audit trail is away' } }
              : { rows: [] },
        }),
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

describe('a reset ends the requests that wait on its hits (rulings 257, 260)', () => {
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

  it('hands back the requests this call closed, and no other', async () => {
    const s = setup();

    const closed = await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    expect(closed.map((row) => row.id)).toEqual(['r-lea', 'r-paul']);
  });

  it('each close is one line of the audit trail, as a direct correction writes', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    expect(writesTo(s.db, 'audit_log').map((write) => write.row)).toEqual([
      {
        actor_user_id: ORGANISER,
        action: 'exchange_edit_request.reject',
        entity_type: 'exchange_edit_request',
        entity_id: 'r-lea',
        payload_json: { request: R_LEA, reason: BOUT_RESET, answeredBy: 'bout_reset' },
      },
      {
        actor_user_id: ORGANISER,
        action: 'exchange_edit_request.reject',
        entity_type: 'exchange_edit_request',
        entity_id: 'r-paul',
        payload_json: { request: R_PAUL, reason: BOUT_RESET, answeredBy: 'bout_reset' },
      },
    ]);
  });

  it('the close tells nobody: the reset has steps left', async () => {
    const s = setup();

    await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });

  it('who asked is told why, once per request the reset closed', async () => {
    const s = setup();

    await s.guard.tellClosedByReset(
      await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER),
    );

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
    expect(writesTo(s.db, 'audit_log')[0]?.row).toMatchObject({ actor_user_id: null });
  });

  it('no bout: nothing is read, written or told', async () => {
    const s = setup();

    await s.guard.tellClosedByReset(await s.guard.rejectPendingEditsForMatch([], ORGANISER));

    expect(s.db.from).not.toHaveBeenCalled();
    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });

  it('a close that fails does not fail the reset, which has landed, and closes nothing', async () => {
    const s = setup('failing');

    await expect(s.guard.rejectPendingEditsForMatch(['m1'], ORGANISER)).resolves.toEqual([]);

    expect(writesTo(s.db, 'audit_log')).toEqual([]);
  });

  // The double throws on a table nobody seeded, as a client whose call rejects.
  it('a close that throws does not fail the reset either', async () => {
    const notifications = { sendImmediate: vi.fn() };
    const guard = new FrozenResultsGuard(mockSupabase({}) as never, notifications as never);

    await expect(guard.rejectPendingEditsForMatch(['m1'], ORGANISER)).resolves.toEqual([]);
  });

  // The requests are closed in the database by then: handing back none would tell nobody.
  it.each<'failing' | 'throwing'>(['failing', 'throwing'])(
    'an audit line that is %s keeps the close, and the next line is still tried',
    async (audit) => {
      const s = setup('seeded', audit);

      const closed = await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

      expect(closed.map((row) => row.id)).toEqual(['r-lea', 'r-paul']);
      expect(s.db.from.mock.calls.filter(([table]) => table === 'audit_log')).toHaveLength(2);
    },
  );

  it('a notice that fails does not fail the reset, and the next asker is still told', async () => {
    const s = setup();
    s.notifications.sendImmediate.mockRejectedValueOnce(new Error('the queue is away'));
    const closed = await s.guard.rejectPendingEditsForMatch(['m1', 'm2'], ORGANISER);

    await expect(s.guard.tellClosedByReset(closed)).resolves.toBeUndefined();

    expect(s.notifications.sendImmediate).toHaveBeenCalledTimes(2);
  });
});
