/**
 * A roster row saved for a Fighter who already holds her profile becomes hers at once (ruling 199).
 * Léa has had her account for a year, and her profile is linked to it. Claire adds her to the Open
 * de Lyon roster with her address. Before, the row stayed unclaimed until Léa pressed "This is me"
 * on her dashboard: the Open was missing from "My events", and no bout alert, Swiss round message
 * or results notice reached her. The row must carry the address of her account (ruling 49(b)):
 * Claire may link any row to any profile, so the link alone proves nothing.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { syncRowsOfClaimedProfile } from './claimed-person-sync';

const LEA = 'u-lea';
const HER_PROFILE = 'gp-lea';
const NOBODYS_PROFILE = 'gp-paul';

/** Léa's new row on the Open's roster, as Claire saved it. */
const OPEN_ROW: SupabaseRow = {
  id: 'p-lea-open',
  global_person_id: HER_PROFILE,
  email: 'lea@example.com',
  claimed_by_user_id: null,
};

function tables(persons: SupabaseRow[]): Record<string, TableSeed> {
  return {
    global_persons: {
      rows: [
        { id: HER_PROFILE, claimed_by_user_id: LEA },
        { id: NOBODYS_PROFILE, claimed_by_user_id: null },
      ],
    },
    persons: { rows: persons },
  };
}

type Account = { ok: boolean; status: number; data: { email?: string } | null };
const HER_ACCOUNT: Account = { ok: true, status: 200, data: { email: 'lea@example.com' } };

const getAuthAdminUser = vi.fn<(userId: string) => Promise<Account>>();
const logger = new Logger('test');
let db: ReturnType<typeof mockSupabase>;
let warn: MockInstance<Logger['warn']>;
let log: MockInstance<Logger['log']>;

/** Claire saves a row linked to `profileId`; the writes to the roster that follow. */
async function saved(profileId: string | null, seed: Record<string, TableSeed>) {
  db = mockSupabase(seed);
  const supabase = { service: { from: db.from }, getAuthAdminUser };
  await syncRowsOfClaimedProfile({ supabase: supabase as never, logger }, profileId);
  return writesTo(db, 'persons');
}

const claimedFor = (ids: string[]) => [
  {
    table: 'persons',
    op: 'update',
    row: { claim_status: 'claimed', claimed_by_user_id: LEA },
    filters: [
      { method: 'in', args: ['id', ids] },
      { method: 'is', args: ['claimed_by_user_id', null] },
    ],
  },
];

beforeEach(() => {
  getAuthAdminUser.mockReset().mockResolvedValue(HER_ACCOUNT);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a roster row saved for a profile that an account holds', () => {
  it('becomes hers when it carries the address of her account', async () => {
    expect(await saved(HER_PROFILE, tables([OPEN_ROW]))).toEqual(claimedFor(['p-lea-open']));
    expect(getAuthAdminUser.mock.calls).toEqual([[LEA]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('becomes hers when Claire typed the address with capitals and spaces', async () => {
    const typed = { ...OPEN_ROW, email: '  Lea@Example.COM ' };
    expect(await saved(HER_PROFILE, tables([typed]))).toEqual(claimedFor(['p-lea-open']));
  });

  it('takes her older rows of the same profile with it', async () => {
    const older = { ...OPEN_ROW, id: 'p-lea-winter' };
    expect(await saved(HER_PROFILE, tables([OPEN_ROW, older]))).toEqual(
      claimedFor(['p-lea-open', 'p-lea-winter']),
    );
  });

  it.each<[string, string | null]>([
    ['another address', 'paul@example.com'],
    ['no address', null],
  ])('stays unclaimed with %s (ruling 49(b)), and says so in the log', async (_, email) => {
    expect(await saved(HER_PROFILE, tables([{ ...OPEN_ROW, email }]))).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      `persons claim-status sync for global_persons ${HER_PROFILE}: claimed 0 of 1 linked rows; the rest carry another address or none`,
    );
  });

  it('is not taken from the account that already holds it', async () => {
    const held = { ...OPEN_ROW, claimed_by_user_id: 'u-other' };
    expect(await saved(HER_PROFILE, tables([held]))).toEqual([]);
  });

  it('is left alone when it is linked to another profile', async () => {
    const elsewhere = { ...OPEN_ROW, global_person_id: NOBODYS_PROFILE };
    expect(await saved(HER_PROFILE, tables([elsewhere]))).toEqual([]);
  });

  it('reads who holds the profile, then the unclaimed rows with their address', async () => {
    await saved(HER_PROFILE, tables([OPEN_ROW]));
    // The double ignores projections: a column left out of a read would still be handed back.
    expect(selectsFor(db.from, 'global_persons')).toEqual(['claimed_by_user_id']);
    expect(selectsFor(db.from, 'persons')).toEqual(['id, email']);
  });
});

describe('a roster row saved with nobody to hand it to', () => {
  it('a profile nobody holds: no account is read, nothing is written', async () => {
    const row = { ...OPEN_ROW, global_person_id: NOBODYS_PROFILE };
    expect(await saved(NOBODYS_PROFILE, tables([row]))).toEqual([]);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('an unknown profile: no account is read, nothing is written', async () => {
    expect(await saved('gp-gone', tables([OPEN_ROW]))).toEqual([]);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
  });

  it('a row with no profile: nothing is read at all', async () => {
    expect(await saved(null, tables([OPEN_ROW]))).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
    expect(getAuthAdminUser).not.toHaveBeenCalled();
  });
});

describe('a failed read never fails the save of the row', () => {
  it('the profile read fails: logged, nothing written', async () => {
    const seed = { ...tables([OPEN_ROW]), global_persons: { error: { message: 'boom' } } };
    expect(await saved(HER_PROFILE, seed)).toEqual([]);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      `persons claim-status sync skipped for global_persons ${HER_PROFILE}: boom`,
    );
  });

  it.each<[string, number]>([
    ['GoTrue refuses the account read', 503],
    ['the account is gone', 404],
    ['GoTrue cannot be reached', 0],
  ])('%s: logged, nothing written', async (_, status) => {
    getAuthAdminUser.mockResolvedValue({ ok: false, status, data: null });
    expect(await saved(HER_PROFILE, tables([OPEN_ROW]))).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      `persons claim-status sync skipped for global_persons ${HER_PROFILE}: the account read answered ${status}`,
    );
  });

  it('anything thrown on the way: logged, nothing written', async () => {
    getAuthAdminUser.mockRejectedValue(new Error('socket hang up'));
    expect(await saved(HER_PROFILE, tables([OPEN_ROW]))).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      `persons claim-status sync skipped for global_persons ${HER_PROFILE}: socket hang up`,
    );
  });

  it.each<[string, Account]>([
    ['an account with no address', { ok: true, status: 200, data: {} }],
    ['an answer that is not an account', { ok: true, status: 200, data: null }],
  ])('%s: logged, nothing written', async (_, account) => {
    getAuthAdminUser.mockResolvedValue(account);
    expect(await saved(HER_PROFILE, tables([OPEN_ROW]))).toEqual([]);
    expect(selectsFor(db.from, 'persons')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      `persons claim-status sync skipped for global_persons ${HER_PROFILE}: the account has no email`,
    );
  });
});
