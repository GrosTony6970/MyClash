import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FighterMergeService } from './merge.service';

// Ruling 133: a merge and a revert are ONE database call each (`merge_fighters`,
// `revert_fighter_merge`, migration 0212), all or nothing. What moves, the refusals and the
// merge record are the functions' own; `scripts/db-merge-probe.mjs` proves them on Postgres.
// This file holds the API's part: the two profile reads, the masked snapshots, the exact call,
// and how a refusal becomes a status.

const SOURCE = {
  id: 'source',
  display_name: 'Lea Source',
  email: 'lea.source@example.com',
  date_of_birth: '1990-04-17',
  merged_into_id: null,
  deleted_at: null,
  allow_being_followed: true,
};
const TARGET = {
  id: 'target',
  display_name: 'Lea Target',
  email: null,
  date_of_birth: '1991-02-03',
  merged_into_id: null,
  deleted_at: null,
  allow_being_followed: true,
};

type Rpc = ReturnType<typeof vi.fn>;

function makeDb(
  profiles: TableSeed = { rows: [SOURCE, TARGET] },
  rpcResult: { data: unknown; error: unknown } = {
    data: { persons: 2, workshopInstructors: 1 },
    error: null,
  },
) {
  const db = mockSupabase({ global_persons: profiles });
  const rpc: Rpc = vi.fn().mockResolvedValue(rpcResult);
  // No follow alerts here: these profiles may be followed, so the merge removes nobody.
  const service = new FighterMergeService(
    { service: { from: db.from, rpc } } as never,
    {} as never,
  );
  return { db, rpc, service };
}

const refusal = (code: string, message: string) => ({ data: null, error: { code, message } });

/** The failure's class AND its words: `toThrow(new X(m))` compares the message only. */
async function expectFailure(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => Error,
  message: string,
) {
  const failure = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(type);
  expect((failure as Error).message).toBe(message);
}

describe('FighterMergeService.merge — one database call (ruling 133)', () => {
  it('reads both profiles whole, then calls merge_fighters once with masked snapshots', async () => {
    const { db, rpc, service } = makeDb();

    const result = await service.merge(
      { sourceId: 'source', targetId: 'target', reason: '  duplicate registration  ' },
      'actor-user',
    );

    // The third read is the survivor's follow choice, once merged (`merge.followers.test.ts`).
    expect(queriedTables(db.from)).toEqual(['global_persons', 'global_persons', 'global_persons']);
    expect(selectsFor(db.from, 'global_persons')).toEqual(['*', '*', 'allow_being_followed']);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toEqual([
      ['id', 'source'],
      ['id', 'target'],
      ['id', 'target'],
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    // The record keeps the profiles as they were, masked the way every audit row is
    // (common/audit-log.ts): the email and the date of birth never reach the table raw.
    expect(rpc).toHaveBeenCalledWith('merge_fighters', {
      p_source_id: 'source',
      p_target_id: 'target',
      p_actor_user_id: 'actor-user',
      p_reason: 'duplicate registration',
      p_source_snapshot: { ...SOURCE, email: 'l***@e***', date_of_birth: '1990-**-**' },
      p_target_snapshot: { ...TARGET, date_of_birth: '1991-**-**' },
    });
    expect(result).toEqual({
      merged: true,
      sourceId: 'source',
      targetId: 'target',
      moved: { persons: 2, workshopInstructors: 1 },
    });
  });

  it('sends no reason as null, and a blank one as null', async () => {
    for (const reason of [undefined, '   ']) {
      const { rpc, service } = makeDb();
      await service.merge({ sourceId: 'source', targetId: 'target', reason }, 'actor-user');
      expect(rpc.mock.calls[0]![1]).toMatchObject({ p_reason: null });
    }
  });

  it('answers a missing profile 404 with its role, and calls nothing', async () => {
    const noSource = makeDb({ rows: [TARGET] });
    await expectFailure(
      noSource.service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
      NotFoundException,
      'source fighter source not found',
    );
    expect(noSource.rpc).not.toHaveBeenCalled();

    const noTarget = makeDb({ rows: [SOURCE] });
    await expectFailure(
      noTarget.service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
      NotFoundException,
      'target fighter target not found',
    );
    expect(noTarget.rpc).not.toHaveBeenCalled();
  });

  it('fails a profile read that errored as a 5xx, never a verdict, and calls nothing', async () => {
    const { rpc, service } = makeDb({ data: null, error: { message: 'connection reset' } });
    const failure = await service
      .merge({ sourceId: 'source', targetId: 'target' }, 'actor')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe('fighter read failed: connection reset');
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the function's refusal (P0001) 400 in its own words", async () => {
    const { service } = makeDb(
      undefined,
      refusal('P0001', 'Source fighter is already merged into another profile'),
    );
    await expectFailure(
      service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
      BadRequestException,
      'Source fighter is already merged into another profile',
    );
  });

  it("answers the function's not-found (P0002) 404 in its own words", async () => {
    const { service } = makeDb(undefined, refusal('P0002', 'target fighter target not found'));
    await expectFailure(
      service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
      NotFoundException,
      'target fighter target not found',
    );
  });

  it('fails any other database error as a 5xx: the merge did not happen, nothing is guessed', async () => {
    const { service } = makeDb(undefined, refusal('23505', 'duplicate key value'));
    const failure = await service
      .merge({ sourceId: 'source', targetId: 'target' }, 'actor')
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe('fighter merge failed: duplicate key value');
  });
});

describe('FighterMergeService.revertMerge — one database call (ruling 133)', () => {
  it('calls revert_fighter_merge once with the record and the actor, and reads no table', async () => {
    const { db, rpc, service } = makeDb(undefined, { data: null, error: null });

    await service.revertMerge('audit-1', 'actor-user');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('revert_fighter_merge', {
      p_audit_log_id: 'audit-1',
      p_actor_user_id: 'actor-user',
    });
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('answers a refusal 400 and an unknown record 404, in the function’s own words', async () => {
    const refused = makeDb(
      undefined,
      refusal('P0001', 'Fighter merge can only be reverted within 30 days'),
    );
    await expectFailure(
      refused.service.revertMerge('audit-1', 'actor'),
      BadRequestException,
      'Fighter merge can only be reverted within 30 days',
    );

    const unknown = makeDb(undefined, refusal('P0002', 'Merge audit log audit-1 not found'));
    await expectFailure(
      unknown.service.revertMerge('audit-1', 'actor'),
      NotFoundException,
      'Merge audit log audit-1 not found',
    );
  });

  it('fails any other database error as a 5xx', async () => {
    const { service } = makeDb(undefined, refusal('23505', 'duplicate key value'));
    const failure = await service.revertMerge('audit-1', 'actor').catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe('fighter merge revert failed: duplicate key value');
  });
});
