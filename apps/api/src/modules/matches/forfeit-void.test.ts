import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';
import {
  assertForfeitsVoidableHere,
  readActiveForfeits,
  voidForfeitRecords,
  type ActiveForfeitRecord,
} from './forfeit-void';

/**
 * A Reset or a Reopen voids its bout's forfeit only when that record reached nothing beyond the
 * bout. Every read it decides on is checked: a read that failed answered "no record" or "nobody
 * out", and the record was voided where nothing settles.
 */

const FAILED: ChainResult = { data: null, error: { message: 'connection lost' } };

const record: ActiveForfeitRecord = {
  id: 'f-1',
  matchId: 'm-1',
  forfeitingRegistrationId: 'reg-a',
  replacementRegistrationId: null,
  fighterOutcome: null,
  autoCreated: false,
};

const serverError = (error: unknown) => {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(HttpException);
};

describe('the reads a Reset or a Reopen decides on', () => {
  it('a failed read of the bouts’ records is a server error, never "no record"', async () => {
    const db = mockSupabase({ match_forfeits: FAILED });
    serverError(await readActiveForfeits(db.service as never, ['m-1']).catch((err) => err));
  });

  it('a failed read of whether the fighter is out is a server error, never "in"', async () => {
    const db = mockSupabase({ registrations: FAILED, match_forfeits: { rows: [] } });
    serverError(await assertForfeitsVoidableHere(db.service as never, [record]).catch((e) => e));
  });

  it('a failed read of the records under it is a server error, never "none"', async () => {
    const db = mockSupabase({
      registrations: { rows: [{ id: 'reg-a', status: 'checked_in' }] },
      match_forfeits: FAILED,
    });
    serverError(await assertForfeitsVoidableHere(db.service as never, [record]).catch((e) => e));
  });

  it('a void the database refuses is a server error, never a void that "took"', async () => {
    const db = mockSupabase({ match_forfeits: FAILED });
    serverError(await voidForfeitRecords(db.service as never, [record], {}).catch((e) => e));
  });

  it('reads that answer let a record of its bout alone through', async () => {
    const db = mockSupabase({
      registrations: { rows: [{ id: 'reg-a', status: 'checked_in' }] },
      match_forfeits: { rows: [] },
    });
    await expect(
      assertForfeitsVoidableHere(db.service as never, [record]),
    ).resolves.toBeUndefined();
  });
});
