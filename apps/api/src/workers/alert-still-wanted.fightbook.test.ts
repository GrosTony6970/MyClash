/**
 * The open-call notices (FightBook slice 5, Decision 15) ring only while they still mean
 * something when they fire: "someone is in" while the call is still OPEN (the poster can still
 * pick), "you were picked" while the spar the pick agreed is still agreed.
 */
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type SupabaseRow,
} from '../common/testing/supabase-chain';
import { isStillWanted } from './alert-still-wanted';
import { isPublicAlert } from './alert-visibility';

const CALL = 'call-1';
const SPAR = 'spar-1';
const LATER = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const EARLIER = new Date(Date.now() - 60 * 1000).toISOString();

function answered(call: SupabaseRow | null) {
  const db = mockSupabase({ spar_open_calls: { rows: call ? [{ id: CALL, ...call }] : [] } });
  const job = { kind: 'spar_call_answered', entityId: CALL, userId: 'u-julie' } as const;
  return { db, answer: isStillWanted(db as never, job) };
}

function picked(spar: SupabaseRow | null) {
  const db = mockSupabase({ spar_requests: { rows: spar ? [{ id: SPAR, ...spar }] : [] } });
  const job = { kind: 'spar_call_picked', entityId: SPAR, userId: 'u-marc' } as const;
  return { db, answer: isStillWanted(db as never, job) };
}

describe('"someone is in" rings only while the call is open', () => {
  it('rings for an open call before its time', async () => {
    const { db, answer } = answered({ status: 'open', closes_at: LATER });
    await expect(answer).resolves.toBe(true);
    expect(queriedTables(db.from)).toEqual(['spar_open_calls']);
    expect(selectsFor(db.from, 'spar_open_calls')).toEqual(['status, closes_at']);
    expect(filtersFor(db.from, 'spar_open_calls', 'eq')).toEqual([['id', CALL]]);
  });

  it.each<[string, SupabaseRow | null]>([
    ['the call passed its time', { status: 'open', closes_at: EARLIER }],
    ['the poster closed it', { status: 'closed', closes_at: LATER }],
    ['the poster already picked', { status: 'picked', closes_at: LATER }],
    ['the call is gone', null],
  ])('stays silent when %s', async (_, call) => {
    await expect(answered(call).answer).resolves.toBe(false);
  });
});

describe('"you were picked" rings only while the spar is agreed', () => {
  it('rings for an agreed spar', async () => {
    const { db, answer } = picked({ status: 'agreed' });
    await expect(answer).resolves.toBe(true);
    expect(queriedTables(db.from)).toEqual(['spar_requests']);
    expect(selectsFor(db.from, 'spar_requests')).toEqual(['status']);
    expect(filtersFor(db.from, 'spar_requests', 'eq')).toEqual([['id', SPAR]]);
  });

  it.each<[string, SupabaseRow | null]>([
    ['the poster cancelled it', { status: 'cancelled' }],
    ['the spar is gone', null],
  ])('stays silent when %s', async (_, spar) => {
    await expect(picked(spar).answer).resolves.toBe(false);
  });
});

const MARC_PROFILE = 'gp-marc';
const JULIE_PROFILE = 'gp-julie';
const AGREED = {
  id: SPAR,
  status: 'agreed',
  asker_global_person_id: MARC_PROFILE,
  receiver_global_person_id: JULIE_PROFILE,
};

function starting(spar: SupabaseRow | null, userId: string) {
  const db = mockSupabase({
    spar_requests: { rows: spar ? [spar] : [] },
    global_persons: {
      rows: [
        { id: MARC_PROFILE, claimed_by_user_id: 'u-marc' },
        { id: JULIE_PROFILE, claimed_by_user_id: 'u-julie' },
        { id: 'gp-other', claimed_by_user_id: 'u-other' },
      ],
    },
  });
  const job = { kind: 'spar_starting', entityId: SPAR, userId } as const;
  return { db, answer: isStillWanted(db as never, job) };
}

describe('"your spar starts in 10 minutes" rings only for an agreed spar the account holds', () => {
  it.each(['u-marc', 'u-julie'])('rings for %s, the holder of one fighter', async (userId) => {
    const { db, answer } = starting(AGREED, userId);
    await expect(answer).resolves.toBe(true);
    expect(selectsFor(db.from, 'spar_requests')).toEqual([
      'status, asker_global_person_id, receiver_global_person_id',
    ]);
    expect(filtersFor(db.from, 'spar_requests', 'eq')).toEqual([['id', SPAR]]);
    expect(selectsFor(db.from, 'global_persons')).toEqual(['id']);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([
      ['id', [MARC_PROFILE, JULIE_PROFILE]],
    ]);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toEqual([['claimed_by_user_id', userId]]);
  });

  it.each<[string, SupabaseRow | null, string]>([
    ['it was cancelled', { ...AGREED, status: 'cancelled' }, 'u-marc'],
    ['it is done', { ...AGREED, status: 'done' }, 'u-marc'],
    ['the spar is gone', null, 'u-marc'],
    ['no profile of it is held by the account (a merge or an unclaim)', AGREED, 'u-other'],
  ])('stays silent when %s', async (_, spar, userId) => {
    await expect(starting(spar, userId).answer).resolves.toBe(false);
  });

  it('is not checked for being public: a spar never is, and the check reads nothing', async () => {
    const db = mockSupabase({});
    const job = { kind: 'spar_starting', entityId: SPAR, userId: 'u-marc' } as const;
    await expect(isPublicAlert(db as never, job)).resolves.toBe(true);
    expect(queriedTables(db.from)).toEqual([]);
  });
});

describe('a failed read fails the job, it does not say "not wanted"', () => {
  it.each(['spar_call_answered', 'spar_call_picked', 'spar_starting'] as const)(
    '%s',
    async (kind) => {
      const failed = { data: null, error: { message: 'boom' } };
      const db = mockSupabase({ spar_open_calls: failed, spar_requests: failed });
      await expect(
        isStillWanted(db as never, { kind, entityId: 'x', userId: 'u' }),
      ).rejects.toThrow('boom');
    },
  );
});
