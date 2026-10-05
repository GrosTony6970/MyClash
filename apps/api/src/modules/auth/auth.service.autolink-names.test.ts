/**
 * The sign-in gives a profile only when no roster row of the account's address has another name
 * (operator ruling 218).
 *
 * Claire types Tom Roux's roster row with Léa's address. Tom's profile is minted and carries that
 * address. Léa then registers under her own name: her profile is minted WITHOUT the address
 * (ruling 211). When Léa signed in, she was given the one unclaimed profile that carries her
 * address: Tom's, with his name and his results.
 *
 * Now the sign-in reads every roster row that carries her address first. One of them has another
 * name than the profile, so it gives nothing, and she claims her profile from her page. The same
 * check stands at the second door, the profile behind a roster row she holds.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { AuthService } from './auth.service';

const LEA = { id: 'u-lea', email: 'lea@example.com', user_metadata: {} };
const signedIn = { headers: { authorization: 'Bearer t' }, cookies: {} } as never;

const profile = (id: string, given: string, family: string, email: string | null): SupabaseRow => ({
  id,
  display_name: `${given} ${family}`.trim(),
  given_name: given,
  family_name: family,
  email,
  claimed_by_user_id: null,
});
const rosterRow = (
  id: string,
  given: string,
  family: string,
  email: string | null,
  profileId: string | null,
): SupabaseRow => ({
  id,
  given_name: given,
  family_name: family,
  email,
  global_person_id: profileId,
  claimed_by_user_id: null,
  claim_status: 'unclaimed',
});

/** Tom's profile, minted from the mistyped row: it carries Léa's address. */
const TOM = profile('gp-tom', 'Tom', 'Roux', LEA.email);
const TOM_ROW = rosterRow('p-tom', 'Tom', 'Roux', LEA.email, 'gp-tom');
/** Léa's profile, minted without the address that Tom's profile holds (ruling 211). */
const LEA_NO_ADDRESS = profile('gp-lea', 'Léa', 'Roux', null);
const LEA_ROW = rosterRow('p-lea', 'Léa', 'Roux', LEA.email, 'gp-lea');
/** Léa's profile when nobody mistyped anything: it carries her address. */
const LEA_OWN = profile('gp-lea', 'Léa', 'Roux', LEA.email);

let db: ReturnType<typeof mockSupabase>;
let service: AuthService;
let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

/** `unreadable` replaces the roster by a canned answer: every read of it gets that. */
function build(profiles: SupabaseRow[], persons: SupabaseRow[], unreadable?: TableSeed) {
  db = mockSupabase({
    global_persons: { rows: profiles },
    persons: unreadable ?? { rows: persons },
    fighter_clubs: { rows: [] },
  });
  service = new AuthService(
    { getAuthUser: vi.fn().mockResolvedValue(LEA), service: db } as never,
    {} as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const signIn = (email = LEA.email) => service.tryAutolinkGlobalPerson(LEA.id, email);
const profileWrites = () => writesTo(db, 'global_persons');
/** The profile a link was written on, with the compare-and-set that guards it. */
const linked = () =>
  profileWrites().map((write) => [
    scopedTo(write, 'id'),
    (write.row as SupabaseRow)['claimed_by_user_id'],
    write.filters.some((f) => f.method === 'is' && f.args[0] === 'claimed_by_user_id'),
  ]);
const REFUSED = (profileId: string) =>
  `global-person link refused for user ${LEA.id}: a roster row of the account's address has another name than global_persons ${profileId}`;

beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sign-in profile link reads the names on the roster (ruling 218)', () => {
  it('gives nothing when a roster row of her address has another name than the profile', async () => {
    build([TOM, LEA_NO_ADDRESS], [TOM_ROW, LEA_ROW]);

    await signIn();

    expect(db.writes).toEqual([]);
    expect(log.mock.calls).toEqual([[REFUSED('gp-tom')]]);
  });

  it('gives her profile when every roster row of her address has its name, however written', async () => {
    build(
      [LEA_OWN],
      [
        LEA_ROW,
        rosterRow('p-lea-2', 'ROUX', 'Lea', LEA.email, 'gp-lea'),
        rosterRow('p-lea-3', 'léa', ' roux.', 'LEA@example.com', null),
      ],
    );

    await signIn();

    expect(linked()).toEqual([['gp-lea', LEA.id, true]]);
  });

  it('THE LIMIT: gives her Tom’s profile when his mistyped row is the only one of her address', async () => {
    build([TOM], [TOM_ROW]);

    await signIn();

    expect(linked()).toEqual([['gp-tom', LEA.id, true]]);
  });

  it('gives a profile whose address is on no roster row', async () => {
    build([LEA_OWN], []);

    await signIn();

    expect(linked()).toEqual([['gp-lea', LEA.id, true]]);
  });

  it('counts only the rows of exactly her address: a look-alike is not hers', async () => {
    // `ilike` reads `_` as "any one character": a sign-in as l_a@… is handed the rows of lea@….
    const address = 'l_a@example.com';
    build(
      [profile('gp-lea', 'Léa', 'Roux', address)],
      [rosterRow('p-lea', 'Léa', 'Roux', address, 'gp-lea'), TOM_ROW],
    );

    await signIn(address);

    expect(linked()).toEqual([['gp-lea', LEA.id, true]]);
  });

  it('gives nothing when the roster rows cannot be read, and says so', async () => {
    build([LEA_OWN], [], { data: null, error: { message: 'timeout' } });

    await signIn();

    expect(db.writes).toEqual([]);
    expect(warn.mock.calls).toEqual([
      [
        `global-person link refused for user ${LEA.id}: roster rows of the account's address unreadable: timeout`,
      ],
    ]);
  });

  it('counts a row of another name whoever holds it, and with no profile behind it', async () => {
    // Her own row, as it is the second time she signs in: held by her account, not yet on a profile.
    const hers = { ...LEA_ROW, global_person_id: null, claimed_by_user_id: LEA.id };
    build([TOM], [TOM_ROW, { ...hers, claim_status: 'claimed' }]);

    await signIn();

    expect(profileWrites()).toEqual([]);
  });

  it('gives nothing for a profile with no name: no name equals nothing', async () => {
    build([profile('gp-nameless', '', '', LEA.email)], [LEA_ROW]);

    await signIn();

    expect(db.writes).toEqual([]);
    expect(log.mock.calls).toEqual([[REFUSED('gp-nameless')]]);
  });

  it('stops there: a refusal does not go on to the profile behind a roster row she holds', async () => {
    build([TOM, LEA_NO_ADDRESS], [TOM_ROW, LEA_ROW]);

    await signIn();

    expect(filtersFor(db.from, 'persons', 'eq')).toEqual([]);
  });

  it('reads the names it compares: the profile’s and the rows’', async () => {
    build([TOM, LEA_NO_ADDRESS], [TOM_ROW, LEA_ROW]);

    await signIn();

    expect(selectsFor(db.from, 'global_persons')).toEqual([
      'id',
      'id, email, given_name, family_name',
    ]);
    expect(selectsFor(db.from, 'persons')).toEqual(['email, given_name, family_name']);
    expect(filtersFor(db.from, 'persons', 'ilike')).toEqual([['email', LEA.email]]);
  });
});

describe('the profile behind a roster row she holds, the same check (ruling 218)', () => {
  it('claims Tom’s row, which carries her address, and does not give her his profile', async () => {
    build([TOM, LEA_NO_ADDRESS], [TOM_ROW, LEA_ROW]);

    await expect(service.claimPersons(signedIn, ['p-tom'])).resolves.toEqual({
      claimed: 1,
      alreadyAtEvent: 0,
    });

    expect(writesTo(db, 'persons').map((write) => scopedTo(write, 'id'))).toEqual(['p-tom']);
    expect(profileWrites()).toEqual([]);
    expect(log.mock.calls).toEqual([[REFUSED('gp-tom')]]);
  });

  it('gives her own profile behind her own row when every row of her address has its name', async () => {
    build([LEA_OWN], [LEA_ROW]);

    await expect(service.claimPersons(signedIn, ['p-lea'])).resolves.toEqual({
      claimed: 1,
      alreadyAtEvent: 0,
    });

    expect(linked()[0]).toEqual(['gp-lea', LEA.id, true]);
  });

  it('reads the name of the profile behind the row', async () => {
    build([TOM, LEA_NO_ADDRESS], [TOM_ROW, LEA_ROW]);

    await service.claimPersons(signedIn, ['p-tom']);

    expect(selectsFor(db.from, 'global_persons')).toContain(
      'id, email, given_name, family_name, claimed_by_user_id, deleted_at, merged_into_id, account_deleted_at',
    );
  });
});
