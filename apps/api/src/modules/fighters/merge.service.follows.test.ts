import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FighterMergeService } from './merge.service';

type MergeAuditPayloadShape = { moved: { directoryFollowerUserIds?: string[] } };

// Ruling 116: a merge moves the directory follows of the merged-away profile to the surviving one,
// and a revert moves exactly those back. Seeded tables, so each write names the rows it touched.
describe('FighterMergeService — directory follows (ruling 116)', () => {
  const SOURCE = { id: 'source', merged_into_id: null, deleted_at: null };
  const TARGET = { id: 'target', merged_into_id: null, deleted_at: null };
  const FOLLOWS = [
    // Alice follows only the merged-away profile: her follow moves.
    { id: 'f-1', follower_user_id: 'alice', followed_global_person_id: 'source' },
    // Bob follows both: his survivor follow stays; the other one stays on the merged profile.
    { id: 'f-2', follower_user_id: 'bob', followed_global_person_id: 'source' },
    { id: 'f-3', follower_user_id: 'bob', followed_global_person_id: 'target' },
    // Carol follows someone else entirely.
    { id: 'f-4', follower_user_id: 'carol', followed_global_person_id: 'someone-else' },
  ];
  const MOVE_TO_TARGET = {
    table: 'directory_follows',
    op: 'update',
    row: { followed_global_person_id: 'target' },
    filters: [
      { method: 'eq', args: ['followed_global_person_id', 'source'] },
      { method: 'in', args: ['follower_user_id', ['alice']] },
    ],
  };

  function mergeDb(follows: TableSeed = { rows: FOLLOWS }) {
    return seededSupabase({
      global_persons: { rows: [SOURCE, TARGET] },
      // One event-scoped person to re-point: a write placed before the follows move shows.
      persons: { rows: [{ id: 'person-1', global_person_id: 'source' }] },
      workshop_instructors: { rows: [] },
      directory_follows: follows,
      audit_log: { data: null, error: null },
    });
  }

  const merge = (db: ReturnType<typeof seededSupabase>) =>
    new FighterMergeService(db as never).merge({ sourceId: 'source', targetId: 'target' }, 'actor');

  function auditPayload(db: ReturnType<typeof seededSupabase>) {
    const insert = writesTo(db, 'audit_log')[0];
    return (insert?.row as { payload_json: MergeAuditPayloadShape }).payload_json;
  }

  function revertDb(moved: Record<string, string[]>) {
    return seededSupabase({
      audit_log: [
        {
          data: {
            id: 'audit-1',
            action: 'fighter.merge',
            entity_id: 'source',
            created_at: new Date().toISOString(),
            payload_json: {
              source: { id: 'source' },
              target: { id: 'target' },
              moved: { personIds: [], workshopInstructorIds: [], ...moved },
            },
          },
          error: null,
        },
        // No later merge of the source (ruling 125), then the revert's own record.
        { data: [], error: null },
        { data: null, error: null },
      ],
      directory_follows: { rows: FOLLOWS },
      global_persons: { rows: [{ ...SOURCE, merged_into_id: 'target' }, TARGET] },
    });
  }

  it('moves a follow of the merged-away profile to the surviving one, first, and records who for the revert', async () => {
    const db = mergeDb();
    await merge(db);

    expect(writesTo(db, 'directory_follows')).toEqual([MOVE_TO_TARGET]);
    // The first write: a follow tapped on the survivor since the read fails it with nothing moved.
    expect(db.writes[0]).toEqual(MOVE_TO_TARGET);
    expect(auditPayload(db).moved.directoryFollowerUserIds).toEqual(['alice']);
  });

  it('reads the follows of both profiles, and nothing else', async () => {
    const db = mergeDb();
    await merge(db);

    // Paged: every read asks the same columns, until an empty page.
    const selects = selectsFor(db.from, 'directory_follows');
    expect(selects.length).toBeGreaterThan(0);
    expect(new Set(selects)).toEqual(new Set(['id, follower_user_id, followed_global_person_id']));
    expect(filtersFor(db.from, 'directory_follows', 'in')[0]).toEqual([
      'followed_global_person_id',
      ['source', 'target'],
    ]);
  });

  it('moves nothing when every follower of the merged-away profile already follows the survivor', async () => {
    const db = mergeDb({ rows: FOLLOWS.filter((row) => row.follower_user_id !== 'alice') });
    await merge(db);

    expect(writesTo(db, 'directory_follows')).toEqual([]);
    expect(auditPayload(db).moved.directoryFollowerUserIds).toEqual([]);
  });

  it('a failed follows read stops the merge before anything is written, as a 5xx', async () => {
    const db = mergeDb({ data: null, error: { message: 'connection reset' } });
    const run = merge(db);

    await expect(run).rejects.toThrow('directory follows read failed: connection reset');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
    expect(db.writes).toEqual([]);
  });

  it('a failed follows move writes nothing else, as a 5xx', async () => {
    const db = mergeDb([
      { data: FOLLOWS, error: null },
      { data: [], error: null }, // the read pages on until an empty page
      { data: null, error: { message: 'duplicate key value violates unique constraint' } },
    ]);
    const run = merge(db);

    await expect(run).rejects.toThrow('directory follows move failed: duplicate key');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
    expect(db.writes.map((write) => write.table)).toEqual(['directory_follows']);
  });

  it('a revert moves exactly the recorded followers back to the restored profile', async () => {
    const db = revertDb({ directoryFollowerUserIds: ['alice'] });
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');

    expect(writesTo(db, 'directory_follows')).toEqual([
      {
        table: 'directory_follows',
        op: 'update',
        row: { followed_global_person_id: 'source' },
        filters: [
          { method: 'eq', args: ['followed_global_person_id', 'target'] },
          { method: 'in', args: ['follower_user_id', ['alice']] },
        ],
      },
    ]);
  });

  it('a merge recorded before follows moved reverts without touching any follow', async () => {
    const db = revertDb({});
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');

    expect(queriedTables(db.from)).not.toContain('directory_follows');
  });
});

// Ruling 125: only the current merge of a profile can be undone, a merged profile is not merged
// again, and a profile's follows move whole, however many there are.
describe('FighterMergeService — merge follow-ups (ruling 125)', () => {
  const MERGE_AUDIT = {
    data: {
      id: 'audit-1',
      action: 'fighter.merge',
      entity_id: 'source',
      created_at: new Date().toISOString(),
      payload_json: {
        source: { id: 'source' },
        target: { id: 'target' },
        moved: { personIds: ['person-1'], workshopInstructorIds: [] },
      },
    },
    error: null,
  };

  function revertDb(sourceMergedInto: string | null, laterMerges: unknown[]) {
    return seededSupabase({
      audit_log: [MERGE_AUDIT, { data: laterMerges, error: null }, { data: null, error: null }],
      global_persons: {
        rows: [
          { id: 'source', merged_into_id: sourceMergedInto },
          { id: 'target', merged_into_id: null },
        ],
      },
      persons: { rows: [] },
      workshop_instructors: { rows: [] },
    });
  }

  it('refuses to merge a profile already merged into another, writing nothing', async () => {
    const db = seededSupabase({
      global_persons: {
        rows: [
          { id: 'source', merged_into_id: 'elsewhere', deleted_at: '2026-09-01T00:00:00Z' },
          { id: 'target', merged_into_id: null, deleted_at: null },
        ],
      },
    });
    const run = new FighterMergeService(db as never).merge(
      { sourceId: 'source', targetId: 'target' },
      'actor',
    );
    await expect(run).rejects.toThrow('Source fighter is already merged into another profile');
    expect(db.writes).toEqual([]);
  });

  it('refuses to revert a merge already reverted, writing nothing', async () => {
    const db = revertDb(null, []);
    const run = new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    await expect(run).rejects.toBeInstanceOf(BadRequestException);
    await expect(run).rejects.toThrow('This fighter merge was already reverted');
    expect(db.writes).toEqual([]);
  });

  it('refuses to revert a merge a later merge of the same profile replaced, writing nothing', async () => {
    const db = revertDb('target', [{ id: 'audit-2' }]);
    const run = new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    await expect(run).rejects.toThrow(
      'A later merge of this fighter replaced this one: revert the later merge first',
    );
    expect(db.writes).toEqual([]);
    // Later: this fighter's merges after this one, by the database's own clock.
    expect(filtersFor(db.from, 'audit_log', 'eq')).toEqual(
      expect.arrayContaining([
        ['action', 'fighter.merge'],
        ['entity_type', 'fighter'],
        ['entity_id', 'source'],
      ]),
    );
    expect(filtersFor(db.from, 'audit_log', 'gt')).toEqual([
      ['created_at', MERGE_AUDIT.data.created_at],
    ]);
  });

  it('refuses to revert while the surviving fighter is itself merged away, writing nothing', async () => {
    const db = seededSupabase({
      audit_log: [MERGE_AUDIT, { data: [], error: null }],
      global_persons: {
        rows: [
          { id: 'source', merged_into_id: 'target' },
          { id: 'target', merged_into_id: 'third' },
        ],
      },
    });
    const run = new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    await expect(run).rejects.toThrow(
      'The surviving fighter was merged into another profile since: revert that merge first',
    );
    expect(db.writes).toEqual([]);
  });

  it('a failed flag write is a 5xx: a merge whose flag never landed cannot pass as reverted', async () => {
    const db = seededSupabase({
      global_persons: [
        { data: { id: 'source', merged_into_id: null, deleted_at: null }, error: null },
        { data: { id: 'target', merged_into_id: null, deleted_at: null }, error: null },
        { data: null, error: null }, // the survivor's blank fields filled
        { data: null, error: { message: 'boom' } }, // the source's merged flag
      ],
      persons: { rows: [] },
      workshop_instructors: { rows: [] },
      directory_follows: { rows: [] },
    });
    const run = new FighterMergeService(db as never).merge(
      { sourceId: 'source', targetId: 'target' },
      'actor',
    );
    await expect(run).rejects.toThrow('fighter write failed: boom');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
    expect(writesTo(db, 'audit_log')).toEqual([]);
  });

  it('reverts the current merge', async () => {
    const db = revertDb('target', []);
    await new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    expect(writesTo(db, 'global_persons')[0]?.row).toMatchObject({ merged_into_id: null });
  });

  it('a failed read of the merge history is a 5xx, not a revert', async () => {
    const db = seededSupabase({
      audit_log: [MERGE_AUDIT, { data: null, error: { message: 'boom' } }],
      global_persons: {
        rows: [
          { id: 'source', merged_into_id: 'target' },
          { id: 'target', merged_into_id: null },
        ],
      },
    });
    const run = new FighterMergeService(db as never).revertMerge('audit-1', 'actor');
    await expect(run).rejects.toThrow('merge history read failed: boom');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
    expect(db.writes).toEqual([]);
  });

  it('moves every follow of a profile with more followers than one page, a chunk at a time', async () => {
    const followers = Array.from({ length: 1001 }, (_, i) => `user-${String(i).padStart(4, '0')}`);
    const db = seededSupabase({
      global_persons: {
        rows: [
          { id: 'source', merged_into_id: null, deleted_at: null },
          { id: 'target', merged_into_id: null, deleted_at: null },
        ],
      },
      persons: { rows: [] },
      workshop_instructors: { rows: [] },
      directory_follows: {
        rows: followers.map((user, i) => ({
          id: `follow-${String(i).padStart(4, '0')}`,
          follower_user_id: user,
          followed_global_person_id: 'source',
        })),
      },
      audit_log: { data: null, error: null },
    });
    await new FighterMergeService(db as never).merge(
      { sourceId: 'source', targetId: 'target' },
      'actor',
    );
    const moves = writesTo(db, 'directory_follows');
    const moved = moves.flatMap(
      (write) => write.filters.find((f) => f.method === 'in')?.args[1] as string[],
    );
    expect(moved).toEqual(followers);
    // Paged by id: each read after the first starts past the last id of the one before.
    expect(filtersFor(db.from, 'directory_follows', 'limit')).toEqual([[1000], [1000], [1000]]);
    expect(filtersFor(db.from, 'directory_follows', 'gt')).toEqual([
      ['id', 'follow-0999'],
      ['id', 'follow-1000'],
    ]);
    // No `in` list longer than a chunk travels in one URL.
    expect(
      moves.map(
        (write) => (write.filters.find((f) => f.method === 'in')?.args[1] as string[]).length,
      ),
    ).toEqual([200, 200, 200, 200, 200, 1]);
  });
});
