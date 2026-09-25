/**
 * Erasure removes other people's rows aimed at the erased profile (operator
 * rulings 113, 113a).
 *
 * Erasure deleted the rows the erased person OWNED (their claim links, claim
 * requests and follows) but not the rows other people aimed at their profile.
 * Since ruling 106 an erased profile is hidden everywhere, so nobody could ever
 * see or act on those rows again: a claim request stayed in no queue forever, a
 * follow stayed in no Following tab, and both still named the profile. Erasure
 * (and the super-admin anonymisation, which also hides the profile) now deletes
 * them. A merge does not: it can be undone.
 */
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ErasureService } from './erasure.service';

const SUBJECT = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';
const OTHER = '6e2d1a8f-3b9c-4d4e-8f7a-1b2c3d4e5f60';
const MARIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const SOMEONE_ELSE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };

const AIMED: ReadonlyArray<[table: string, column: string]> = [
  ['global_person_claim_tokens', 'global_person_id'],
  ['global_person_claim_requests', 'global_person_id'],
  ['directory_follows', 'followed_global_person_id'],
];

function tables(): Record<string, TableSeed> {
  return {
    global_persons: {
      rows: [
        { id: MARIE, claimed_by_user_id: SUBJECT, slug: 'marie' },
        { id: SOMEONE_ELSE, claimed_by_user_id: OTHER, slug: 'luc' },
      ],
    },
    persons: { rows: [] },
    guest_sessions: { rows: [] },
    // Paul's claim link, request and follow aimed at Marie; one of each at someone else; and one of
    // each Marie made herself, which erasure already deleted as hers.
    global_person_claim_tokens: {
      rows: [
        { id: 't-1', user_id: OTHER, global_person_id: MARIE },
        { id: 't-2', user_id: OTHER, global_person_id: SOMEONE_ELSE },
        { id: 't-3', user_id: SUBJECT, global_person_id: SOMEONE_ELSE },
      ],
    },
    global_person_claim_requests: {
      rows: [
        { id: 'r-1', user_id: OTHER, global_person_id: MARIE, status: 'rejected' },
        { id: 'r-2', user_id: OTHER, global_person_id: SOMEONE_ELSE, status: 'pending' },
        { id: 'r-3', user_id: SUBJECT, global_person_id: SOMEONE_ELSE, status: 'pending' },
      ],
    },
    directory_follows: {
      rows: [
        { id: 'f-1', follower_user_id: OTHER, followed_global_person_id: MARIE },
        { id: 'f-2', follower_user_id: OTHER, followed_global_person_id: SOMEONE_ELSE },
        { id: 'f-3', follower_user_id: SUBJECT, followed_global_person_id: SOMEONE_ELSE },
      ],
    },
    person_email_change_requests: { rows: [] },
    follows: { rows: [] },
    organization_follows: { rows: [] },
    notification_preferences: { rows: [] },
    push_subscriptions: { rows: [] },
    // Canned: its read filters with `contains`, which the seeded double does not model.
    audit_log: { data: [], error: null },
  };
}

function erasureWith(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(seed);
  return { erasure: new ErasureService(supabase as never), supabase };
}

/** The deletes on `table` scoped by `column`, as the ids each one named. */
function deletesBy(
  supabase: ReturnType<typeof mockSupabase>,
  table: string,
  column: string,
): unknown[] {
  return supabase.writes
    .filter((w) => w.table === table && w.op === 'delete')
    .flatMap((w) => w.filters.filter((f) => f.args[0] === column).map((f) => f.args[1]));
}

describe('erasure removes rows other people aimed at the erased profile (rulings 113, 113a)', () => {
  it.each(AIMED)(
    'erasing an account deletes the %s aimed at its profile',
    async (table, column) => {
      const { erasure, supabase } = erasureWith(tables());

      await erasure.redactSubject(SUBJECT);

      expect(deletesBy(supabase, table, column)).toEqual([[MARIE]]);
    },
  );

  it('counts them in the erasure receipt beside the rows the person owned', async () => {
    const { erasure } = erasureWith(tables());

    const counts = await erasure.redactSubject(SUBJECT);

    // One the person owned plus one aimed at their profile, in each table.
    expect(counts['global_person_claim_tokens']).toBe(2);
    expect(counts['global_person_claim_requests']).toBe(2);
    expect(counts['directory_follows']).toBe(2);
  });

  it('deletes them before the profile loses its owner, so a retry still finds them', async () => {
    // The profile ids come from `claimed_by_user_id`, which the profile update
    // clears. A delete that failed after it could never be retried.
    const { erasure, supabase } = erasureWith(tables());

    await erasure.redactSubject(SUBJECT);

    const at = (table: string, op: string) =>
      supabase.writes.findIndex((w) => w.table === table && w.op === op);
    const ownerCleared = at('global_persons', 'update');
    expect(ownerCleared).toBeGreaterThan(-1);
    for (const [table] of AIMED) {
      expect(at(table, 'delete')).toBeGreaterThan(-1);
      expect(at(table, 'delete')).toBeLessThan(ownerCleared);
    }
  });

  it('deletes nothing aimed at a profile when the account claimed none', async () => {
    const seed = tables();
    const { erasure, supabase } = erasureWith({ ...seed, global_persons: { rows: [] } });

    await erasure.redactSubject(SUBJECT);

    for (const [table, column] of AIMED) expect(deletesBy(supabase, table, column)).toEqual([]);
  });

  it.each(AIMED)('anonymising a profile deletes the %s aimed at it', async (table, column) => {
    const { erasure, supabase } = erasureWith(tables());

    await erasure.anonymiseGlobalPerson(MARIE);

    expect(deletesBy(supabase, table, column)).toEqual([[MARIE]]);
  });

  it('fails the erasure loudly when one of those deletes fails', async () => {
    // A queue: the delete aimed at the profile fails; the person's own would succeed.
    const { erasure, supabase } = erasureWith({
      ...tables(),
      global_person_claim_requests: [FAILED, { data: [], error: null }],
    });

    await expect(erasure.redactSubject(SUBJECT)).rejects.toThrow(
      'delete global_person_claim_requests: boom',
    );
    // It stopped there: the person's own requests were never reached, nor was the profile.
    expect(deletesBy(supabase, 'global_person_claim_requests', 'user_id')).toEqual([]);
    expect(supabase.writes.some((w) => w.table === 'global_persons')).toBe(false);
  });
});
