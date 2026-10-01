/**
 * An organiser's save that leaves a claimed roster row with an address that is not its holder's
 * account address frees the row (rulings 203, 203a). Claire adds Tom to the Open and types Léa's
 * address by mistake. Léa has an account, so the row becomes Léa's at once: the Open shows in her
 * "My events" and Tom's notices go to her. Claire corrects the address, or deletes it. Before,
 * nothing gave the row back: it stayed Léa's, Tom was refused when he claimed it, and only
 * deleting Léa's account freed it.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  mockSupabase,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { freeRowOfAnotherAddress } from './claimed-person-sync';

const LEA = 'u-lea';
/** Tom's row as Claire's save left it: still held by Léa's account. */
const savedRow = (email: string | null, holder: string | null = LEA) => ({
  id: 'p-tom-open',
  email,
  claimed_by_user_id: holder,
});

type Account = { ok: boolean; status: number; data: { email?: string } | null };
const HER_ACCOUNT: Account = { ok: true, status: 200, data: { email: 'lea@example.com' } };

const getAuthAdminUser = vi.fn<(userId: string) => Promise<Account>>();
const logger = new Logger('test');
let db: ReturnType<typeof mockSupabase>;
let warn: MockInstance<Logger['warn']>;
let log: MockInstance<Logger['log']>;

/** Claire saves the row; the writes to the roster that follow. */
async function saved(
  row: ReturnType<typeof savedRow>,
  persons: TableSeed = { rows: [row as SupabaseRow] },
) {
  db = mockSupabase({ persons });
  const supabase = { service: { from: db.from }, getAuthAdminUser };
  await freeRowOfAnotherAddress({ supabase: supabase as never, logger }, row);
  return writesTo(db, 'persons');
}

const FREED = [
  {
    table: 'persons',
    op: 'update',
    row: { claim_status: 'unclaimed', claimed_by_user_id: null },
    filters: [
      { method: 'eq', args: ['id', 'p-tom-open'] },
      { method: 'eq', args: ['claimed_by_user_id', LEA] },
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

describe("a roster row that Léa's account holds, after Claire's save", () => {
  it("is freed when it now carries Tom's address", async () => {
    expect(await saved(savedRow('tom@example.com'))).toEqual(FREED);
    expect(getAuthAdminUser.mock.calls).toEqual([[LEA]]);
    expect(log.mock.calls).toEqual([
      ["persons p-tom-open freed from its account: its address is not the account's"],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, string | null]>([
    ['deleted', null],
    ['left empty', ''],
    ['left as spaces', '   '],
  ])('is freed when its address was %s (ruling 203a)', async (_, email) => {
    expect(await saved(savedRow(email))).toEqual(FREED);
  });

  it('is freed when Claire swaps her address for another one of hers (the ruled cost)', async () => {
    expect(await saved(savedRow('lea@work.example'))).toEqual(FREED);
  });

  it.each(['lea@example.com', '  Lea@Example.COM '])(
    'stays hers when it still carries the address of her account (%s)',
    async (email) => {
      expect(await saved(savedRow(email))).toEqual([]);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('reads nothing of the roster: the saved row is handed in', async () => {
    await saved(savedRow('tom@example.com'));
    expect(db.from.mock.calls).toEqual([['persons']]);
  });

  it('a row nobody holds: no account is read, nothing is written', async () => {
    expect(await saved(savedRow('tom@example.com', null))).toEqual([]);
    expect(getAuthAdminUser).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('a release that cannot be decided frees nothing, and never fails the save', () => {
  it.each<[string, Account, string]>([
    ['GoTrue refuses the account read', { ok: false, status: 503, data: null }, 'answered 503'],
    ['the account is gone', { ok: false, status: 404, data: null }, 'answered 404'],
    ['GoTrue cannot be reached', { ok: false, status: 0, data: null }, 'answered 0'],
    ['an answer that is not an account', { ok: true, status: 200, data: null }, 'answered 200'],
  ])('%s: logged, nothing written', async (_, account, said) => {
    getAuthAdminUser.mockResolvedValue(account);
    expect(await saved(savedRow('tom@example.com'))).toEqual([]);
    expect(warn.mock.calls).toEqual([[`persons p-tom-open not freed: the account read ${said}`]]);
  });

  it('an account with no address: logged, nothing written', async () => {
    getAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: {} });
    expect(await saved(savedRow('tom@example.com'))).toEqual([]);
    expect(warn.mock.calls).toEqual([['persons p-tom-open not freed: the account has no email']]);
  });

  it('anything thrown on the way: logged, nothing written', async () => {
    getAuthAdminUser.mockRejectedValue(new Error('socket hang up'));
    expect(await saved(savedRow('tom@example.com'))).toEqual([]);
    expect(warn.mock.calls).toEqual([['persons p-tom-open not freed: socket hang up']]);
  });

  it('the write fails: logged, and the log does not say it was freed', async () => {
    await saved(savedRow('tom@example.com'), { error: { message: 'boom' } });
    expect(warn.mock.calls).toEqual([['persons p-tom-open not freed: boom']]);
    expect(log).not.toHaveBeenCalled();
  });
});
