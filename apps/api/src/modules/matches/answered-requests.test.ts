import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard, type ExchangeEditRequestRow } from './frozen-results.guard';
import { MatchesService } from './matches.service';

/**
 * A waiting correction request that a direct correction answers (rulings 253,
 * 253a, 254).
 *
 * Léa asks to void a hit of an over Event; her request waits for a review.
 * Marc, a super admin, corrects the same hit himself. The request could never
 * be approved after that ("Exchange is already voided") and held its slot until
 * somebody rejected it by hand.
 *
 * - 253: the same correction closes the request as approved, Marc its reviewer.
 * - 253a: every approval tells who asked, the click on Approve too.
 * - 254: an EDIT of the hit closes a waiting void request as rejected, with a
 *   fixed reason, and tells who asked.
 */
const MARC = 'a0000000-0000-4000-8000-000000000001';
const LEA = 'a0000000-0000-4000-8000-000000000002';
const APPROVED_TITLE = 'Demande de correction approuvée / Exchange correction approved';
const APPROVED_BODY =
  'La correction demandée a été faite. / The correction you asked for was made.';
const REJECTED_TITLE = 'Demande de correction refusée / Exchange correction rejected';
const HIT_CHANGED =
  'Un administrateur a modifié cet échange. Refaites une demande si le nouvel échange est faux lui aussi. / An administrator changed this exchange. Ask again if the new exchange is wrong too.';

const request = (id: string, exchangeId: string, type: string, status = 'pending') => ({
  id,
  event_id: 'event-1',
  match_id: 'm1',
  exchange_id: exchangeId,
  requested_by_user_id: LEA,
  request_type: type,
  reason: 'the video shows no hit',
  status,
});

/** One bout: a live hit and a voided hit, each with a waiting request, and decoys. */
function setup(eventStatus = 'completed', requests: 'seeded' | 'failing' = 'seeded') {
  const db = mockSupabase({
    exchanges: {
      rows: [
        { id: 'hit-live', match_id: 'm1', voided: false, sequence: 1, round_number: 1 },
        { id: 'hit-voided', match_id: 'm1', voided: true, sequence: 2, round_number: 1 },
      ],
      returning: { id: 'hit-new' },
    },
    matches: { rows: [{ id: 'm1', phase_id: 'phase-1', locked_at: null }] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1' }] },
    events: { rows: [{ id: 'event-1', status: eventStatus }] },
    platform_roles: { rows: [{ user_id: MARC, role: 'super_admin' }] },
    exchange_edit_requests:
      requests === 'failing'
        ? { data: null, error: { message: 'the database is away' } }
        : {
            rows: [
              request('r-void', 'hit-live', 'void_exchange'),
              request('r-restore', 'hit-voided', 'revert_void_exchange'),
              // Decoys: another hit, and a request of this hit that is reviewed.
              request('r-other-hit', 'hit-other', 'void_exchange'),
              request('r-reviewed', 'hit-live', 'void_exchange', 'rejected'),
            ],
          },
    audit_log: { data: null, error: null },
    match_events: { rows: [] },
  });
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
  };
  const notifications = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
  const guard = new FrozenResultsGuard(db as never, notifications as never);
  const service = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
    guard,
  );
  const closed = () => writesTo(db, 'exchange_edit_requests');
  const audits = () => writesTo(db, 'audit_log').map((write) => write.row);
  return { db, scoring, notifications, guard, service, closed, audits };
}

const approvedNotice = (requestId: string) => ({
  kind: 'exchange_edit_approved',
  entityId: requestId,
  userId: LEA,
  title: APPROVED_TITLE,
  body: APPROVED_BODY,
  url: '/notifications',
  preference: 'schedule_changes',
});

describe('a direct correction answers the request that waits on its hit (ruling 253)', () => {
  it('a void closes the waiting void request as approved, and names who made it', async () => {
    const s = setup();

    await s.service.voidExchange('hit-live', { reason: 'no hit' }, { userId: MARC });

    expect(s.closed()).toEqual([
      {
        table: 'exchange_edit_requests',
        op: 'update',
        row: {
          status: 'approved',
          reviewed_by_user_id: MARC,
          reviewed_at: expect.any(String),
          updated_at: expect.any(String),
        },
        filters: [
          { method: 'eq', args: ['exchange_id', 'hit-live'] },
          { method: 'eq', args: ['request_type', 'void_exchange'] },
          { method: 'eq', args: ['status', 'pending'] },
        ],
      },
    ]);
    // The notice and the audit row need the whole request: the double ignores a projection.
    expect(selectsFor(s.db.from, 'exchange_edit_requests')).toEqual(['*']);
    expect(s.notifications.sendImmediate.mock.calls).toEqual([[approvedNotice('r-void')]]);
    expect(s.audits()).toContainEqual(
      expect.objectContaining({
        actor_user_id: MARC,
        action: 'exchange_edit_request.approve',
        entity_type: 'exchange_edit_request',
        entity_id: 'r-void',
      }),
    );
    expect(s.scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('a restore closes the waiting restore request as approved', async () => {
    const s = setup();

    await s.service.revertVoidExchange('hit-voided', { userId: MARC });

    expect(s.closed().map((write) => write.filters)).toEqual([
      [
        { method: 'eq', args: ['exchange_id', 'hit-voided'] },
        { method: 'eq', args: ['request_type', 'revert_void_exchange'] },
        { method: 'eq', args: ['status', 'pending'] },
      ],
    ]);
    expect(s.closed()[0]?.row).toMatchObject({ status: 'approved', reviewed_by_user_id: MARC });
    expect(s.notifications.sendImmediate.mock.calls).toEqual([[approvedNotice('r-restore')]]);
  });

  it('on a running Event an organiser’s void closes a request left from before', async () => {
    const s = setup('running');

    await s.service.voidExchange('hit-live', { reason: 'no hit' }, { userId: LEA });

    expect(s.closed()[0]?.row).toMatchObject({ status: 'approved', reviewed_by_user_id: LEA });
    expect(s.notifications.sendImmediate).toHaveBeenCalledTimes(1);
  });

  it('a pad’s void names no reviewer: a staff account is not an account', async () => {
    const s = setup('running');

    await s.service.voidExchange('hit-live', { reason: 'no hit' }, { staffAccountId: 'staff-1' });

    expect(s.closed()[0]?.row).toMatchObject({ status: 'approved', reviewed_by_user_id: null });
  });

  it('no request waits: nothing is told and nothing is logged for a request', async () => {
    const s = setup();

    await s.guard.closeAnswered('hit-with-no-request', 'void_exchange', { userId: MARC });

    expect(s.closed()).toHaveLength(1);
    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
    expect(s.audits()).toEqual([]);
  });

  it('a close that fails does not fail the correction, which has landed', async () => {
    const s = setup('completed', 'failing');

    await expect(
      s.service.voidExchange('hit-live', { reason: 'no hit' }, { userId: MARC }),
    ).resolves.toMatchObject({ id: 'hit-live' });

    expect(s.scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });
});

describe('an edit of the hit ends the request that asked to void it (ruling 254)', () => {
  const EDIT = { type: 'no_exchange', noExchangeReason: 'other', reason: 'wrong side' };

  it('the request is rejected with the fixed reason, and who asked is told why', async () => {
    const s = setup();

    await s.service.editExchange('hit-live', EDIT as never, { userId: MARC });

    expect(s.closed()).toEqual([
      {
        table: 'exchange_edit_requests',
        op: 'update',
        row: {
          status: 'rejected',
          rejection_reason: HIT_CHANGED,
          reviewed_by_user_id: MARC,
          reviewed_at: expect.any(String),
          updated_at: expect.any(String),
        },
        filters: [
          { method: 'eq', args: ['exchange_id', 'hit-live'] },
          { method: 'eq', args: ['request_type', 'void_exchange'] },
          { method: 'eq', args: ['status', 'pending'] },
        ],
      },
    ]);
    expect(s.notifications.sendImmediate.mock.calls).toEqual([
      [
        {
          kind: 'exchange_edit_rejected',
          entityId: 'r-void',
          userId: LEA,
          title: REJECTED_TITLE,
          body: HIT_CHANGED,
          url: '/notifications',
          preference: 'schedule_changes',
        },
      ],
    ]);
    expect(s.audits()).toContainEqual(
      expect.objectContaining({
        actor_user_id: MARC,
        action: 'exchange_edit_request.reject',
        entity_id: 'r-void',
      }),
    );
    expect(s.scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });
});

describe('every approval tells who asked (ruling 253a)', () => {
  const WAITING = request('r-void', 'hit-live', 'void_exchange') as ExchangeEditRequestRow;

  it('a click on Approve voids the hit, and only `markApproved` closes its request', async () => {
    const s = setup();

    await s.service.approveFrozenExchangeEdit(WAITING, MARC);

    expect(writesTo(s.db, 'exchanges').map((write) => write.row)).toEqual([
      { voided: true, voided_reason: WAITING.reason },
    ]);
    expect(s.closed()).toEqual([]);
    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
  });

  it('`markApproved` tells who asked', async () => {
    const s = setup();

    await s.guard.markApproved(WAITING, MARC);

    expect(s.closed().map((write) => write.filters)).toEqual([
      [
        { method: 'eq', args: ['id', 'r-void'] },
        { method: 'eq', args: ['status', 'pending'] },
      ],
    ]);
    expect(s.notifications.sendImmediate.mock.calls).toEqual([[approvedNotice('r-void')]]);
  });

  // A direct correction closed it, and told who asked, after the review read it.
  it.each<[string, (s: ReturnType<typeof setup>) => Promise<void>]>([
    ['an approval', (s) => s.guard.markApproved({ ...WAITING, id: 'r-reviewed' }, MARC)],
    ['a rejection', (s) => s.guard.markRejected({ ...WAITING, id: 'r-reviewed' }, MARC, 'no')],
  ])('%s of a request that no longer waits is refused, and tells nobody', async (_name, review) => {
    const s = setup();

    await expect(review(s)).rejects.toThrow('Request is already reviewed');

    expect(s.notifications.sendImmediate).not.toHaveBeenCalled();
    expect(s.audits()).toEqual([]);
  });

  it('the score is computed before the close: a score does not wait on a notice', async () => {
    const s = setup();
    const order: string[] = [];
    s.scoring.recomputeMatchScore.mockImplementation(async () => {
      order.push('score');
      return { redScore: 0, blueScore: 0 };
    });
    s.notifications.sendImmediate.mockImplementation(async () => {
      order.push('notice');
    });

    await s.service.voidExchange('hit-live', { reason: 'no hit' }, { userId: MARC });
    await s.service.revertVoidExchange('hit-voided', { userId: MARC });

    expect(order).toEqual(['score', 'notice', 'score', 'notice']);
  });
});
