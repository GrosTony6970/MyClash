import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';

/**
 * Ruling 222a: an archived Event's results are corrected as a completed Event's
 * are. An Event archives itself a day after its last Tournament is completed
 * and never comes back, so "frozen while completed" let an organiser change a
 * finished score directly from day two, with no review.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000001';
const SUPER_ADMIN = 'a0000000-0000-4000-8000-000000000002';
const EVENT = 'e0000000-0000-4000-8000-000000000001';
const BOUT = 'b0000000-0000-4000-8000-000000000001';
const EXCHANGE = { id: 'c0000000-0000-4000-8000-000000000001', match_id: BOUT, voided: false };

function setup(status: string) {
  const db = mockSupabase({
    matches: { rows: [{ id: BOUT, phase_id: 'phase-1' }] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: EVENT }] },
    events: { rows: [{ id: EVENT, status }] },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
    exchange_edit_requests: { rows: [], returning: { id: 'request-1' } },
    audit_log: { rows: [] },
  });
  return { db, guard: new FrozenResultsGuard(db as never, {} as never) };
}

const askToVoid = (guard: FrozenResultsGuard, userId: string) =>
  guard.guardExchangeMutation({
    exchange: EXCHANGE,
    requestType: 'void_exchange',
    reason: 'wrong side',
    userId,
  });

describe('FrozenResultsGuard', () => {
  it.each<[string, boolean]>([
    ['published', false],
    ['running', false],
    // A status nobody writes: a check that froze everything but "running" would pass the rest.
    ['pending', false],
    ['completed', true],
    ['archived', true],
  ])('a result write on a %s Event is frozen: %s', async (status, frozen) => {
    const { guard } = setup(status);
    const write = guard.assertResultMutationAllowed(BOUT, ORGANISER);
    // The object form: the pad and web-admin say it in their reader's language by its `code`.
    if (frozen)
      await expect(write).rejects.toEqual(
        new ConflictException({
          message: 'Event results are frozen',
          code: 'event_results_frozen',
        }),
      );
    else await expect(write).resolves.toBeUndefined();
  });

  it.each<[string, boolean]>([
    ['running', false],
    ['pending', false],
    ['completed', true],
    ['archived', true],
  ])('says whether a %s Event is over: %s', async (status, over) => {
    expect(await setup(status).guard.isEventOver(BOUT)).toBe(over);
  });

  it('lets a super admin change a result of an archived Event', async () => {
    const { guard } = setup('archived');
    await expect(guard.assertResultMutationAllowed(BOUT, SUPER_ADMIN)).resolves.toBeUndefined();
  });

  it('turns an organiser’s void on an archived Event into a request for a super admin', async () => {
    const { db, guard } = setup('archived');

    expect(await askToVoid(guard, ORGANISER)).toEqual({
      pendingReview: true,
      requestId: 'request-1',
      status: 'pending',
    });
    const [request] = writesTo(db, 'exchange_edit_requests');
    expect(request?.row).toMatchObject({
      event_id: EVENT,
      exchange_id: EXCHANGE.id,
      requested_by_user_id: ORGANISER,
      request_type: 'void_exchange',
      status: 'pending',
    });
  });

  // Ruling 258: a restore carries no reason, and a reviewer of either language reads the request.
  it.each<[string, string | null, string]>([
    ['the reason given, trimmed', '  wrong side ', 'wrong side'],
    ['no reason', null, 'Aucune raison donnée / No reason given'],
    ['a blank reason', '   ', 'Aucune raison donnée / No reason given'],
  ])('a request is saved with %s', async (_name, given, saved) => {
    const { db, guard } = setup('completed');

    await guard.guardExchangeMutation({
      exchange: EXCHANGE,
      requestType: 'revert_void_exchange',
      reason: given,
      userId: ORGANISER,
    });

    const [request] = writesTo(db, 'exchange_edit_requests');
    expect(request?.row).toMatchObject({
      reason: saved,
      requested_payload: { requestedReason: saved },
    });
  });

  it('lets the void through on a running Event, with no request', async () => {
    const { db, guard } = setup('running');
    expect(await askToVoid(guard, ORGANISER)).toBeNull();
    expect(writesTo(db, 'exchange_edit_requests')).toEqual([]);
  });

  it('lets a super admin void on an archived Event directly', async () => {
    const { db, guard } = setup('archived');
    expect(await askToVoid(guard, SUPER_ADMIN)).toBeNull();
    expect(writesTo(db, 'exchange_edit_requests')).toEqual([]);
  });
});
