/**
 * A platform admin's change of an account's address reaches the roster rows the account holds
 * (ruling 204). Léa asks support to move her account from lea@old.example to lea@new.example, and
 * a platform admin changes it on the Accounts page. Before, her roster rows kept the old address:
 * the emails of her results notices went there, and Claire's next save of her row would have
 * found an address that is not her account's and freed the row (ruling 203). Her own "change my
 * address" already rewrote them: both doors share `moveClaimedRowsToAddress`.
 *
 * A roster cannot hold one address twice, and the move is one write. So the change is refused
 * whole, before the account changes, when another row of one of her rosters has the address.
 */
import { BadRequestException, ConflictException, HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { AdminUsersService } from './admin-users.service';
import type { UpdatePlatformUserDto } from './dto/admin-users.dto';

const LEA = 'u-lea';
const ADMIN = 'u-admin';
const NEW = 'lea_m@new.example';
const HER_ROWS: SupabaseRow[] = [
  { id: 'p-lea-open', event_id: 'e-open', claimed_by_user_id: LEA, email: 'lea@old.example' },
  { id: 'p-lea-winter', event_id: 'e-winter', claimed_by_user_id: LEA, email: 'lea@old.example' },
];
/** Somebody else's row: on the Open's roster unless a test says otherwise. */
const other = (email: string, event_id = 'e-open'): SupabaseRow => ({
  id: 'p-other',
  event_id,
  claimed_by_user_id: null,
  email,
});

const updateAuthAdminUser = vi.fn();
const getAuthAdminUser = vi.fn();
let db: ReturnType<typeof mockSupabase>;

/** The platform admin saves Léa's account on the Accounts page. */
async function saved(dto: UpdatePlatformUserDto, persons: TableSeed = { rows: HER_ROWS }) {
  db = mockSupabase({
    persons,
    audit_log: { data: null, error: null },
    organization_members: { rows: [] },
    platform_roles: { rows: [] },
  });
  const supabase = { ...db, updateAuthAdminUser, getAuthAdminUser };
  const service = new AdminUsersService(supabase as never, {} as never, {} as never);
  return service.updateUser(LEA, dto, ADMIN);
}

/** A save that fails: its error. */
const failure = (dto: UpdatePlatformUserDto, persons: TableSeed) =>
  saved(dto, persons).then(
    () => null,
    (error: unknown) => error,
  );

const moved = {
  table: 'persons',
  op: 'update',
  row: { email: NEW, updated_at: expect.any(String) },
  filters: [{ method: 'eq', args: ['claimed_by_user_id', LEA] }],
};

beforeEach(() => {
  const account = { ok: true, status: 200, data: { id: LEA, email: NEW } };
  updateAuthAdminUser.mockReset().mockResolvedValue(account);
  getAuthAdminUser.mockReset().mockResolvedValue(account);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a platform admin changes the address of Léa's account", () => {
  it('moves the roster rows her account holds to the new address', async () => {
    await saved({ email: ' Lea_M@New.Example ' });
    expect(updateAuthAdminUser.mock.calls).toEqual([[LEA, { email: NEW }]]);
    expect(writesTo(db, 'persons')).toEqual([moved]);
  });

  it('asks first whether a roster she is on already has the address', async () => {
    await saved({ email: NEW });
    // The double ignores projections: a column left out of a read would still be handed back.
    expect(selectsFor(db.from, 'persons')).toEqual(['id, event_id', 'id, email']);
    expect(filtersFor(db.from, 'persons', 'eq')).toEqual([
      ['claimed_by_user_id', LEA],
      ['claimed_by_user_id', LEA],
    ]);
    expect(filtersFor(db.from, 'persons', 'in')).toEqual([['event_id', ['e-open', 'e-winter']]]);
    expect(filtersFor(db.from, 'persons', 'ilike')).toEqual([['email', NEW]]);
  });

  it('refuses the change whole when another row of her roster has the address', async () => {
    const refusal = await failure({ email: NEW }, { rows: [...HER_ROWS, other(NEW)] });
    expect(refusal).toBeInstanceOf(ConflictException);
    expect(String(refusal)).toContain(
      'Another person on a roster of this account has this address',
    );
    expect(updateAuthAdminUser).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it.each<[string, SupabaseRow[]]>([
    ['a look-alike address on her roster', [...HER_ROWS, other('leaXm@new.example')]],
    ['the address on a roster she is not on', [...HER_ROWS, other(NEW, 'e-other')]],
    ['her own row, already at the address', [{ ...HER_ROWS[0], email: NEW }, HER_ROWS[1]!]],
    ['an account that holds no row', [other(NEW)]],
  ])('%s is not in the way', async (_, rows) => {
    await saved({ email: NEW }, { rows });
    expect(updateAuthAdminUser).toHaveBeenCalledTimes(1);
    expect(writesTo(db, 'persons')).toEqual([moved]);
  });

  it('touches no row when only her display name is saved', async () => {
    await saved({ displayName: 'Léa' });
    expect(db.from.mock.calls.filter(([table]) => table === 'persons')).toEqual([]);
  });

  it('moves no row when GoTrue refuses the new address', async () => {
    updateAuthAdminUser.mockResolvedValue({ ok: false, status: 422, data: null });
    await expect(saved({ email: NEW })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toEqual([]);
  });
});

describe('a read or a write of her roster rows fails', () => {
  const boom = { data: null, error: { message: 'boom' } };
  const held = { data: [{ id: 'p-lea-open', event_id: 'e-open' }], error: null };

  it.each<[string, TableSeed, string]>([
    ['her rows cannot be read', [boom], 'Error: Roster rows of u-lea unreadable: boom'],
    ['her rosters cannot be read', [held, boom], 'Error: Roster address read failed: boom'],
  ])('%s: a server error, and the account is not changed', async (_, persons, message) => {
    const error = await failure({ email: NEW }, persons);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toBe(message);
    expect(updateAuthAdminUser).not.toHaveBeenCalled();
  });

  it('her rows cannot be written: a server error, after the audit line', async () => {
    const error = await failure({ email: NEW }, [{ data: [], error: null }, boom]);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toBe('Error: Roster rows of u-lea kept their address: boom');
    // The account has changed, and the log says so. The admin saves again: that save moves them.
    expect(writesTo(db, 'audit_log')).toHaveLength(1);
  });
});
