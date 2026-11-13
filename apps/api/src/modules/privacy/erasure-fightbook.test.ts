/**
 * Account erasure deletes every FightBook row of the erased profile: what they wrote and what was
 * aimed at them (FightBook slice 1, Decision 13). Anonymisation does not call this; its test is in
 * erasure.service.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, type ChainResult } from '../../common/testing/supabase-chain';
import { buildMigrationSchema } from '../../common/testing/migration-schema';
import { eraseFightBookRows, FIGHTBOOK_ROWS } from './erasure-fightbook';

const MARIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const LUC = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';

/** The floor tools' rows (slice 5): Marie's and Luc's, one of Luc's picking Marie. */
const FLOOR_ROWS = {
  spar_open_call_answers: {
    rows: [
      { id: 'oa-1', call_id: 'c-2', answerer_global_person_id: MARIE },
      { id: 'oa-2', call_id: 'c-1', answerer_global_person_id: LUC },
    ],
  },
  spar_open_calls: {
    rows: [
      { id: 'c-1', poster_global_person_id: MARIE, picked_global_person_id: null },
      { id: 'c-2', poster_global_person_id: LUC, picked_global_person_id: MARIE },
      { id: 'c-3', poster_global_person_id: LUC, picked_global_person_id: PAUL },
    ],
  },
  fightbook_free_now: {
    rows: [
      { id: 'fn-1', global_person_id: MARIE },
      { id: 'fn-2', global_person_id: LUC },
    ],
  },
  fightbook_qr_codes: {
    rows: [
      { id: 'q-1', global_person_id: MARIE },
      { id: 'q-2', global_person_id: MARIE },
      { id: 'q-3', global_person_id: LUC },
    ],
  },
};

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
    ...FLOOR_ROWS,
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
    ['spar_open_call_answers', 'answerer_global_person_id'],
    ['spar_open_calls', 'picked_global_person_id'],
    ['spar_open_calls', 'poster_global_person_id'],
    ['fightbook_free_now', 'global_person_id'],
    ['fightbook_qr_codes', 'global_person_id'],
  ])('deletes %s by %s', async (table, column) => {
    const supabase = seeded();
    await eraseFightBookRows(supabase.service as never, [MARIE]);
    expect(deletes(supabase, table)).toContainEqual([column, [MARIE]]);
  });

  it('reads every delete back with select("id"), so the counts are real', async () => {
    const supabase = seeded();
    await eraseFightBookRows(supabase.service as never, [MARIE]);
    for (const [table] of FIGHTBOOK_ROWS) {
      expect(selectsFor(supabase.from, table), table).toContain('id');
    }
    expect(new Set(selectsFor(supabase.from, 'spar_open_calls'))).toEqual(new Set(['id']));
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
      // c-1 by poster, c-2 by pick: each found by its own delete.
      spar_open_calls: 2,
      spar_open_call_answers: 1,
      fightbook_free_now: 1,
      fightbook_qr_codes: 2,
    });
  });

  it('deletes the floor rows before the requests, the QR codes before anything else', async () => {
    const supabase = seeded();
    await eraseFightBookRows(supabase.service as never, [MARIE]);
    const order = supabase.writes.filter((w) => w.op === 'delete').map((w) => w.table);
    for (const table of ['spar_open_call_answers', 'spar_open_calls', 'fightbook_free_now']) {
      expect(order.indexOf(table), table).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(table), table).toBeLessThan(order.indexOf('spar_requests'));
    }
    expect(order[0]).toBe('fightbook_qr_codes');
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
      fightbook_qr_codes: { data: [], error: null },
      fightbook_free_now: { data: [], error: null },
      spar_open_call_answers: { data: [], error: null },
      spar_open_calls: { data: [], error: null },
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
