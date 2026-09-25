import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.insert.mockResolvedValue(result);
  return chain;
}

describe('FighterMergeService', () => {
  let service: FighterMergeService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new FighterMergeService(mockSupabase as never);
  });

  it('rejects merging a fighter into itself', async () => {
    await expect(
      service.merge({ sourceId: 'fighter-1', targetId: 'fighter-1' }, 'actor-user'),
    ).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects missing source or target fighter', async () => {
    const sourceChain = makeChain({ data: null, error: null });
    sourceChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const targetChain = makeChain({ data: null, error: null });
    targetChain.maybeSingle.mockResolvedValue({ data: { id: 'target' }, error: null });
    fromMock.mockReturnValueOnce(sourceChain).mockReturnValueOnce(targetChain);

    await expect(
      service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
    ).rejects.toThrow(NotFoundException);
  });

  it('moves references, fills blank target fields, soft-deletes source, and audits merge', async () => {
    const source = {
      id: 'source',
      slug: 'source-fighter',
      display_name: 'Source Fighter',
      photo_url: 'https://cdn/source.jpg',
      hema_ratings_id: '123',
      bio: 'source bio',
      country_code: 'FR',
      gender_category: 'open',
      merged_into_id: null,
      deleted_at: null,
    };
    const target = {
      id: 'target',
      slug: 'target-fighter',
      display_name: 'Target Fighter',
      photo_url: null,
      hema_ratings_id: null,
      bio: null,
      country_code: 'BE',
      gender_category: null,
      merged_into_id: null,
      deleted_at: null,
    };

    const sourceChain = makeChain({ data: null, error: null });
    sourceChain.maybeSingle.mockResolvedValue({ data: source, error: null });
    const targetChain = makeChain({ data: null, error: null });
    targetChain.maybeSingle.mockResolvedValue({ data: target, error: null });
    const personsSelect = makeChain({ data: [{ id: 'person-1' }], error: null });
    personsSelect.select.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'person-1' }], error: null }),
    });
    const instructorsSelect = makeChain({ data: [{ id: 'instructor-1' }], error: null });
    instructorsSelect.select.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'instructor-1' }], error: null }),
    });
    const fighterUpdate = makeChain({ data: null, error: null });
    const personsUpdate = makeChain({ data: null, error: null });
    const instructorsUpdate = makeChain({ data: null, error: null });
    const auditInsert = makeChain({ data: null, error: null });
    // Nobody follows either profile: nothing to move.
    const followsSelect = makeChain({ data: [], error: null });
    followsSelect.select.mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const fighterChains = [sourceChain, targetChain];
    fromMock.mockImplementation((table: string) => {
      if (table === 'directory_follows') return followsSelect;
      if (table === 'global_persons') return fighterChains.shift() ?? fighterUpdate;
      if (table === 'persons')
        return personsSelect.select.mock.calls.length ? personsUpdate : personsSelect;
      if (table === 'workshop_instructors') {
        return instructorsSelect.select.mock.calls.length ? instructorsUpdate : instructorsSelect;
      }
      if (table === 'audit_log') return auditInsert;
      return makeChain({ data: null, error: null });
    });

    const result = await service.merge(
      { sourceId: 'source', targetId: 'target', reason: 'duplicate registration' },
      'actor-user',
    );

    expect(result).toEqual({
      merged: true,
      sourceId: 'source',
      targetId: 'target',
      moved: { persons: 1, workshopInstructors: 1 },
    });
    const fighterUpdateCalls = fighterUpdate.update.mock.calls;
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fighter.merge',
        payload_json: expect.objectContaining({
          moved: {
            personIds: ['person-1'],
            workshopInstructorIds: ['instructor-1'],
            directoryFollowerUserIds: [],
          },
          reason: 'duplicate registration',
        }),
      }),
    );
    expect(personsUpdate.update).toHaveBeenCalledWith({ global_person_id: 'target' });
    expect(instructorsUpdate.update).toHaveBeenCalledWith({ global_person_id: 'target' });
    expect(fighterUpdateCalls).toContainEqual([
      expect.objectContaining({
        merged_into_id: 'target',
        merge_reverted_at: null,
      }),
    ]);
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'actor-user',
        action: 'fighter.merge',
        entity_type: 'fighter',
        entity_id: 'source',
        payload_json: expect.objectContaining({
          moved: {
            personIds: ['person-1'],
            workshopInstructorIds: ['instructor-1'],
            directoryFollowerUserIds: [],
          },
          reason: 'duplicate registration',
        }),
      }),
    );
  });

  it('reverts a merge from audit payload within 30 days', async () => {
    const auditChain = makeChain({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'audit-1',
        action: 'fighter.merge',
        entity_id: 'source',
        created_at: new Date().toISOString(),
        payload_json: {
          source: { id: 'source' },
          target: { id: 'target' },
          moved: {
            personIds: ['person-1'],
            registrationIds: ['registration-1'],
            workshopInstructorIds: ['instructor-1'],
          },
        },
      },
      error: null,
    });
    auditChain.select.mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    const personsUpdate = makeChain({ data: null, error: null });
    const instructorsUpdate = makeChain({ data: null, error: null });
    const sourceUpdate = makeChain({ data: null, error: null });
    const auditInsert = makeChain({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'audit_log')
        return auditChain.select.mock.calls.length ? auditInsert : auditChain;
      if (table === 'persons') return personsUpdate;
      if (table === 'workshop_instructors') return instructorsUpdate;
      if (table === 'global_persons') return sourceUpdate;
      return makeChain({ data: null, error: null });
    });

    await service.revertMerge('audit-1', 'actor-user');

    // Reverting persons.global_person_id automatically reverts the
    // registrations that referenced those persons — no direct
    // registrations.fighter_id cascade after 0083.
    expect(personsUpdate.update).toHaveBeenCalledWith({ global_person_id: 'source' });
    expect(instructorsUpdate.update).toHaveBeenCalledWith({ global_person_id: 'source' });
    expect(sourceUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        merged_into_id: null,
        merged_at: null,
        deleted_at: null,
      }),
    );
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'actor-user',
        action: 'fighter.merge_revert',
        entity_id: 'source',
      }),
    );
  });

  it('rejects merge reverts after 30 days', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const auditChain = makeChain({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'audit-1',
        action: 'fighter.merge',
        entity_id: 'source',
        created_at: oldDate,
        payload_json: { source: { id: 'source' }, target: { id: 'target' }, moved: {} },
      },
      error: null,
    });
    auditChain.select.mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    fromMock.mockImplementation((table: string) =>
      table === 'audit_log' ? auditChain : makeChain({ data: null, error: null }),
    );

    await expect(service.revertMerge('audit-1', 'actor-user')).rejects.toThrow(BadRequestException);
  });
});

// Ruling 116: a merge moves the directory follows of the merged-away profile to the surviving one,
// and a revert moves exactly those back. Seeded tables, so each write names the rows it touched.
describe('FighterMergeService — directory follows (ruling 116)', () => {
  const SOURCE = { id: 'source', merged_into_id: null, deleted_at: null };
  const TARGET = { id: 'target', merged_into_id: null, deleted_at: null };
  const FOLLOWS = [
    // Alice follows only the merged-away profile: her follow moves.
    { follower_user_id: 'alice', followed_global_person_id: 'source' },
    // Bob follows both: his survivor follow stays; the other one stays on the merged profile.
    { follower_user_id: 'bob', followed_global_person_id: 'source' },
    { follower_user_id: 'bob', followed_global_person_id: 'target' },
    // Carol follows someone else entirely.
    { follower_user_id: 'carol', followed_global_person_id: 'someone-else' },
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
      audit_log: {
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
      directory_follows: { rows: FOLLOWS },
      global_persons: { rows: [SOURCE] },
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

    expect(selectsFor(db.from, 'directory_follows')).toEqual([
      'follower_user_id, followed_global_person_id',
    ]);
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
