/**
 * Account erasure deletes every FightBook row of the erased profile: what they wrote and what was
 * aimed at them (FightBook slice 1, Decision 13). Anonymisation does not call this; its test is in
 * erasure.service.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';
import { buildMigrationSchema } from '../../common/testing/migration-schema';
import { eraseFightBookRows, FIGHTBOOK_ROWS } from './erasure-fightbook';

const MARIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const LUC = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';

function seeded() {
  return mockSupabase({
    spar_requests: {
      rows: [
        { id: 'r-1', asker_global_person_id: MARIE, receiver_global_person_id: LUC },
        { id: 'r-2', asker_global_person_id: LUC, receiver_global_person_id: MARIE },
        { id: 'r-3', asker_global_person_id: LUC, receiver_global_person_id: PAUL },
      ],
    },
    spar_private_notes: {
      rows: [
        { id: 'n-1', author_global_person_id: MARIE },
        { id: 'n-2', author_global_person_id: LUC },
      ],
    },
    fightbook_blocks: {
      rows: [
        { id: 'b-1', blocker_global_person_id: MARIE, blocked_global_person_id: LUC },
        { id: 'b-2', blocker_global_person_id: PAUL, blocked_global_person_id: MARIE },
        { id: 'b-3', blocker_global_person_id: LUC, blocked_global_person_id: PAUL },
      ],
    },
    spar_thanks: {
      rows: [
        { id: 't-1', author_global_person_id: MARIE, subject_global_person_id: LUC },
        { id: 't-2', author_global_person_id: LUC, subject_global_person_id: MARIE },
        { id: 't-3', author_global_person_id: LUC, subject_global_person_id: PAUL },
      ],
    },
    spar_anonymous_reviews: {
      rows: [
        { id: 'a-1', author_global_person_id: MARIE, subject_global_person_id: LUC },
        { id: 'a-2', author_global_person_id: PAUL, subject_global_person_id: LUC },
      ],
    },
    fightbook_favourites: {
      rows: [
        { id: 'f-1', owner_global_person_id: MARIE, favourite_global_person_id: LUC },
        { id: 'f-2', owner_global_person_id: LUC, favourite_global_person_id: MARIE },
        { id: 'f-3', owner_global_person_id: LUC, favourite_global_person_id: PAUL },
      ],
    },
  });
}

/** The ids each delete on `table` was scoped to, by column. */
function deletes(supabase: ReturnType<typeof mockSupabase>, table: string) {
  return supabase.writes
    .filter((w) => w.table === table && w.op === 'delete')
    .flatMap((w) => w.filters.map((f) => f.args));
}

describe('eraseFightBookRows', () => {
  it.each([
    ['spar_requests', 'asker_global_person_id'],
    ['spar_requests', 'receiver_global_person_id'],
    ['spar_private_notes', 'author_global_person_id'],
    ['fightbook_blocks', 'blocker_global_person_id'],
    ['fightbook_blocks', 'blocked_global_person_id'],
    ['spar_thanks', 'author_global_person_id'],
    ['spar_thanks', 'subject_global_person_id'],
    ['spar_anonymous_reviews', 'author_global_person_id'],
    ['spar_anonymous_reviews', 'subject_global_person_id'],
    ['fightbook_favourites', 'owner_global_person_id'],
    ['fightbook_favourites', 'favourite_global_person_id'],
  ])('deletes %s by %s', async (table, column) => {
    const supabase = seeded();
    await eraseFightBookRows(supabase.service as never, [MARIE]);
    expect(deletes(supabase, table)).toContainEqual([column, [MARIE]]);
  });

  it('adds the counts of the two deletes on one table, never keeps only the last', async () => {
    const supabase = seeded();
    const counts = await eraseFightBookRows(supabase.service as never, [MARIE]);
    expect(counts).toEqual({
      spar_requests: 2,
      spar_private_notes: 1,
      fightbook_blocks: 2,
      spar_thanks: 2,
      spar_anonymous_reviews: 1,
      fightbook_favourites: 2,
    });
  });

  it('deletes the reviews and favourites before the requests they hang from', async () => {
    const supabase = seeded();
    await eraseFightBookRows(supabase.service as never, [MARIE]);
    const order = supabase.writes.filter((w) => w.op === 'delete').map((w) => w.table);
    const firstRequest = order.indexOf('spar_requests');
    for (const table of ['spar_thanks', 'spar_anonymous_reviews', 'fightbook_favourites']) {
      expect(order.indexOf(table), table).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(table), table).toBeLessThan(firstRequest);
    }
  });

  it('names a real id column and a real person column on every table it deletes from', () => {
    const schema = buildMigrationSchema();
    for (const [table, column] of FIGHTBOOK_ROWS) {
      const columns = schema.columns.get(table);
      expect(columns?.has('id'), `${table}.id`).toBe(true);
      expect(columns?.has(column), `${table}.${column}`).toBe(true);
    }
  });

  it('touches nothing when the account held no profile', async () => {
    const supabase = seeded();
    expect(await eraseFightBookRows(supabase.service as never, [])).toEqual({});
    expect(supabase.writes).toEqual([]);
  });

  it('fails loudly when a delete fails', async () => {
    const failed: ChainResult = { data: null, error: { message: 'boom' } };
    const supabase = mockSupabase({
      spar_private_notes: { data: [], error: null },
      spar_thanks: { data: [], error: null },
      spar_anonymous_reviews: { data: [], error: null },
      fightbook_favourites: { data: [], error: null },
      spar_requests: failed,
      fightbook_blocks: { data: [], error: null },
    });
    await expect(eraseFightBookRows(supabase.service as never, [MARIE])).rejects.toThrow(
      'delete spar_requests: boom',
    );
  });
});
