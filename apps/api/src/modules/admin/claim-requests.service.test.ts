import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import {
  mockSupabase as seededSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type RecordedWrite,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ClaimRequestsService } from './claim-requests.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const getUserByIdMock = vi.fn();
const sendNotificationMock = vi.fn().mockResolvedValue(undefined);

const mockMail = {
  sendNotification: sendNotificationMock,
};

/**
 * Tables routed by NAME, not by call order.
 *
 * The approve path reads the request, claims the profile, backfills its email,
 * reads the linked roster rows and writes the ones it may claim, then marks the
 * request decided — six queries over four tables. The old fixture handed chains
 * out by `mockReturnValueOnce` in sequence, so inserting the roster read shifted
 * every later answer by one and `markDecided` was handed the sweep's chain: a
 * TypeError rather than a verdict. `supabase-chain.ts` exists for exactly this.
 */
function seed(byTable: Record<string, TableSeed>) {
  const db = seededSupabase(byTable);
  return {
    db,
    service: new ClaimRequestsService(
      { service: { from: db.from, auth: { admin: { getUserById: getUserByIdMock } } } } as never,
      mockMail as never,
    ),
  };
}

/** The id list an `in('col', [...])` scoped a write to — `scopedTo` sees only `eq`. */
const inScoped = (write: RecordedWrite | undefined, column: string): unknown[] =>
  (write?.filters ?? []).find((filter) => filter.method === 'in' && filter.args[0] === column)
    ?.args[1] as unknown[];

const REQUEST = {
  id: 'req-1',
  user_id: 'user-1',
  global_person_id: 'global-1',
  status: 'pending',
};

/** Another pending request, seeded FIRST — what a lost `id` filter picks up. */
const REQUEST_DECOY = {
  id: 'req-other',
  user_id: 'other-user',
  global_person_id: 'global-2',
  status: 'pending',
};

describe('ClaimRequestsService.approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'req@example.com' } },
      error: null,
    });
  });

  it('claims the profile, flips the requester’s linked persons and notifies them', async () => {
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST_DECOY, REQUEST] },
      // Email already present → the backfill branch is skipped.
      global_persons: { rows: [{ id: 'global-1', email: 'req@example.com' }] },
      persons: {
        rows: [
          // Another account's row, and one an organiser linked here carrying a
          // stranger's address: neither is the requester's to claim (ruling 49).
          {
            id: 'p-owned',
            global_person_id: 'global-1',
            email: 'req@example.com',
            claimed_by_user_id: 'other-user',
          },
          {
            id: 'p-stranger',
            global_person_id: 'global-1',
            email: 'marie@example.com',
            claimed_by_user_id: null,
          },
          {
            id: 'p-elsewhere',
            global_person_id: 'global-2',
            email: 'req@example.com',
            claimed_by_user_id: null,
          },
          {
            id: 'p-mine',
            global_person_id: 'global-1',
            email: ' Req@Example.com ',
            claimed_by_user_id: null,
          },
        ],
      },
    });

    await service.approve('req-1', 'admin-1');

    const [claim] = writesTo(db, 'global_persons');
    expect(claim?.row).toMatchObject({ claimed_by_user_id: 'user-1' });
    expect(scopedTo(claim, 'id')).toBe('global-1');

    const [sync] = writesTo(db, 'persons');
    expect(sync?.row).toEqual({ claim_status: 'claimed', claimed_by_user_id: 'user-1' });
    expect(inScoped(sync, 'id')).toEqual(['p-mine']);
    // The double ignores the projection: name the column the decision reads.
    expect(selectsFor(db.from, 'persons')).toContain('id, email');

    const [decided] = writesTo(db, 'global_person_claim_requests');
    expect(decided?.row).toMatchObject({ status: 'approved', decided_by_user_id: 'admin-1' });
    expect(scopedTo(decided, 'id')).toBe('req-1');
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  // The ruled cost of 49(b), from the other side: approving a claim no longer
  // flips a linked row that carries no address or somebody else's.
  it('writes no persons row when none carries the requester’s address', async () => {
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST_DECOY, REQUEST] },
      global_persons: { rows: [{ id: 'global-1', email: 'req@example.com' }] },
      persons: {
        rows: [
          { id: 'p-nameless', global_person_id: 'global-1', email: null, claimed_by_user_id: null },
          {
            id: 'p-stranger',
            global_person_id: 'global-1',
            email: 'marie@example.com',
            claimed_by_user_id: null,
          },
        ],
      },
    });

    await service.approve('req-1', 'admin-1');

    expect(writesTo(db, 'persons')).toEqual([]);
    // The profile itself is still handed over, and the request still decided.
    expect(scopedTo(writesTo(db, 'global_persons')[0], 'id')).toBe('global-1');
    expect(writesTo(db, 'global_person_claim_requests')[0]?.row).toMatchObject({
      status: 'approved',
    });
  });

  // Trimmed as well as lower-cased: 0075's unique index is on LOWER(email),
  // which does not trim, so a padded address would sit beside its own twin —
  // and `ilike` is anchored, so the email link would find neither of them.
  it('backfills the profile email when it has none, before sweeping', async () => {
    getUserByIdMock.mockResolvedValue({
      data: { user: { email: ' Req@Example.com ' } },
      error: null,
    });
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST] },
      global_persons: { rows: [{ id: 'global-1', email: null }] },
      persons: {
        rows: [
          {
            id: 'p-mine',
            global_person_id: 'global-1',
            email: 'req@example.com',
            claimed_by_user_id: null,
          },
        ],
      },
    });

    await service.approve('req-1', 'admin-1');

    const [, backfill] = writesTo(db, 'global_persons');
    expect(backfill?.row).toEqual({ email: 'req@example.com' });
    expect(inScoped(writesTo(db, 'persons')[0], 'id')).toEqual(['p-mine']);
  });

  // With no address to compare, no row can be shown to be the requester's, so
  // the roster is never read. Asserted on the tables ASKED: the sweep's own
  // failure is swallowed by design, so an unconfigured-table throw would look
  // exactly like a clean skip from the writes alone.
  it('reads no roster rows when the requester’s address cannot be looked up', async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { email: null } }, error: null });
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST] },
      global_persons: { rows: [{ id: 'global-1', email: 'req@example.com' }] },
    });

    await service.approve('req-1', 'admin-1');

    expect(queriedTables(db.from)).not.toContain('persons');
    expect(writesTo(db, 'global_person_claim_requests')[0]?.row).toMatchObject({
      status: 'approved',
    });
  });

  /**
   * A GoTrue failure is not "this account has no address".
   *
   * Since the sweep needs the address, a lookup answered as `null` would
   * approve a claim that back-filled no roster row and notified nobody — and
   * `markDecided` takes the row out of the queue, so nobody could retry it.
   * The read runs first and refuses, leaving the request pending and the
   * profile unclaimed. See `reference_gotrue_4xx_is_not_a_token_verdict`.
   */
  it('refuses the approval, writing nothing, when the email lookup fails', async () => {
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST] },
      global_persons: { rows: [{ id: 'global-1', email: null }] },
    });

    await expect(service.approve('req-1', 'admin-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(writesTo(db, 'global_persons')).toEqual([]);
    expect(writesTo(db, 'global_person_claim_requests')).toEqual([]);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('does not sync persons when the profile was already claimed', async () => {
    const { db, service } = seed({
      global_person_claim_requests: { rows: [REQUEST] },
      // The race-guard update matches nothing: someone else holds it already.
      global_persons: { rows: [{ id: 'global-1', claimed_by_user_id: 'someone-else' }] },
      persons: { rows: [] },
    });

    await expect(service.approve('req-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

    // The sweep never RAN — `writesTo` alone would also pass if it ran and
    // found nothing, which is a different thing to prove.
    expect(queriedTables(db.from)).not.toContain('persons');
    expect(writesTo(db, 'global_person_claim_requests')[0]?.row).toMatchObject({
      status: 'rejected',
      decision_reason: 'already_claimed',
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
