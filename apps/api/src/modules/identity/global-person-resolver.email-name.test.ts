/**
 * An address alone no longer links a roster row to a profile of another NAME (operator ruling 211).
 *
 * Claire types Léa's address on Tom's roster row, or Tom is Léa's brother and the family shares
 * one address. The resolver reused "the profile that already owns this address", whatever its
 * name: Tom's bouts counted on Léa's fighter page, and nothing repaired the link. Tom gets his own
 * profile now. The accepted cost: Léa under another spelling gets a second profile, which an admin
 * merge joins.
 *
 * `global_persons` is a canned QUEUE, in the order the resolver asks: the address read, then the
 * profiles its roster rows sit on (when rows match), then the insert, then what a collision asks.
 * The cases are about what each of those answers, in turn; the filters are pinned by argument.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { GlobalPersonResolverService } from './global-person-resolver.service';
import { sameName } from './same-name';

const ADDRESS = 'lea@example.com';
const LEA = { id: 'gp-lea', email: ADDRESS, given_name: 'Léa', family_name: 'Roux' };
const holder = (profile: Record<string, unknown> | null) => ({
  data: profile ? [profile] : [],
  error: null,
});
const MINTED = { data: { id: 'gp-new' }, error: null };
const TAKEN = { data: null, error: { message: 'duplicate key value violates unique constraint' } };

function resolve(
  globalPersons: TableSeed,
  name: { givenName: string; familyName: string },
  identifiers: { clubId?: string | null; hemaRatingsId?: string | null } = {},
  persons: TableSeed = { data: [], error: null },
) {
  const db = mockSupabase({ global_persons: globalPersons, persons });
  const answer = new GlobalPersonResolverService(db as never).resolveOrCreateGlobalPerson({
    ...name,
    clubId: identifiers.clubId ?? null,
    hemaRatingsId: identifiers.hemaRatingsId ?? null,
    dateOfBirth: null,
    email: ADDRESS,
    genderCategory: null,
  });
  const inserted = () => writesTo(db, 'global_persons').map((write) => write.row);
  return { db, answer, inserted };
}

const TOM = { givenName: 'Tom', familyName: 'Roux' };
const REFUSED = 'email link refused: global_persons gp-lea holds the address under another name';
const logged = () => vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the address links only a profile of the same name (ruling 211)', () => {
  it('links her own row: the same name at the same address', async () => {
    const log = logged();
    const { answer, inserted } = resolve([holder(LEA)], { givenName: 'Léa', familyName: 'Roux' });

    await expect(answer).resolves.toEqual({ id: 'gp-lea', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['another case', { givenName: 'LÉA', familyName: 'roux' }],
    ['no accents', { givenName: 'Lea', familyName: 'Roux' }],
    ['the two columns swapped', { givenName: 'Roux', familyName: 'Léa' }],
    ['other spacing and punctuation', { givenName: ' Léa ', familyName: 'Roux.' }],
  ])('links her row typed with %s', async (_, name) => {
    const { answer, inserted } = resolve([holder(LEA)], name);

    await expect(answer).resolves.toMatchObject({ id: 'gp-lea', created: false });
    expect(inserted()).toEqual([]);
  });

  it("gives Tom his own profile, without the address that is Léa's, and says so", async () => {
    const log = logged();
    const { answer, inserted } = resolve([holder(LEA), MINTED], TOM);

    // His row carries the address: the next one finds this profile through it (ruling 211a).
    await expect(answer).resolves.toEqual({
      id: 'gp-new',
      created: true,
      mintReason: 'first_sighting',
    });
    // 0075's unique index forbids two unmerged profiles with one address.
    expect(inserted()).toMatchObject([{ given_name: 'Tom', family_name: 'Roux', email: null }]);
    // The trace of the refusal: the profile's id, no name and no address.
    expect(log.mock.calls).toEqual([[REFUSED]]);
  });

  it("still asks the roster rows for Tom's HEMA Ratings id before minting", async () => {
    // Tier 1 finds no profile with the id; the address is Léa's; the roster rows name one profile.
    const { answer, inserted } = resolve(
      [holder(null), holder(LEA), { data: { id: 'gp-tom' }, error: null }],
      TOM,
      { hemaRatingsId: '4242' },
      { data: [{ global_person_id: 'gp-tom' }], error: null },
    );

    await expect(answer).resolves.toEqual({ id: 'gp-tom', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
  });

  it('mints with the address when no profile holds it', async () => {
    const { answer, inserted } = resolve([holder(null), MINTED], TOM);

    await expect(answer).resolves.toMatchObject({ created: true, mintReason: 'first_sighting' });
    expect(inserted()).toMatchObject([{ email: ADDRESS }]);
  });

  it('reads the name with the address: the double ignores a projection', async () => {
    const { db, answer } = resolve([holder(LEA)], { givenName: 'Léa', familyName: 'Roux' });

    await answer;

    expect(selectsFor(db.from, 'global_persons')).toEqual(['id, email, given_name, family_name']);
    // Canned, so the filters are held by argument: this address, among the unmerged profiles.
    expect(filtersFor(db.from, 'global_persons', 'ilike')).toEqual([['email', ADDRESS]]);
    expect(filtersFor(db.from, 'global_persons', 'is')).toEqual([['merged_into_id', null]]);
  });
});

/**
 * Rulings 211a, 211b and 211c. A profile minted without its address could never be found again:
 * "Léa Roux-Martin" with no club and no HEMA Ratings id got a NEW profile at every Event. Her
 * roster rows still carry the address and that name, and say which profile they sit on.
 */
describe('roster rows of the same address and name find the profile again (ruling 211a)', () => {
  const rosterRow = (profile: string, givenName: string, familyName: string, email = ADDRESS) => ({
    global_person_id: profile,
    email,
    given_name: givenName,
    family_name: familyName,
  });
  const rows = (...data: Array<ReturnType<typeof rosterRow>>) => ({ data, error: null });
  /** A live profile the rows sit on, as the read hands it back: oldest first. */
  const profile = (id: string, email: string | null = null) => ({ id, email });
  const live = (...data: Array<ReturnType<typeof profile>>) => ({ data, error: null });
  const MARTIN = { givenName: 'Léa', familyName: 'Roux-Martin' };
  const TOMS_ROW = rows(rosterRow('gp-tom', 'Tom', 'Roux'));
  const MATCHED = 'roster rows of the same address and name matched: ';

  it('links her second spelling to the profile its rows already sit on, and says so', async () => {
    const log = logged();
    const { db, answer, inserted } = resolve(
      [holder(LEA), live(profile('gp-lea-2'))],
      MARTIN,
      {},
      rows(rosterRow('gp-lea', 'Léa', 'Roux'), rosterRow('gp-lea-2', 'LEA', 'roux martin')),
    );

    await expect(answer).resolves.toEqual({ id: 'gp-lea-2', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
    expect(log.mock.calls).toEqual([[REFUSED], [`${MATCHED}gp-lea-2`]]);
    // Only the profile of the row with her address AND this name is asked for.
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', ['gp-lea-2']]]);
  });

  it("links Tom to his own profile, from his earlier row at Léa's address", async () => {
    const { answer, inserted } = resolve(
      [holder(LEA), live(profile('gp-tom'))],
      TOM,
      {},
      rows(rosterRow('gp-lea', 'Léa', 'Roux'), rosterRow('gp-tom', 'Tom', 'Roux')),
    );

    await expect(answer).resolves.toEqual({ id: 'gp-tom', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
  });

  it('follows the rows to the survivor of an admin merge, whatever its name', async () => {
    // Last year's "Léa Roux-Martin" row was merged onto Léa Roux's profile, which has the address.
    const { answer } = resolve(
      [holder(LEA), live(profile('gp-lea', ADDRESS))],
      MARTIN,
      {},
      rows(rosterRow('gp-lea', 'Léa', 'Roux'), rosterRow('gp-lea', 'Léa', 'Roux-Martin')),
    );

    await expect(answer).resolves.toEqual({ id: 'gp-lea', created: false, mintReason: null });
  });

  it('also asks when no profile holds the address', async () => {
    const { answer, inserted } = resolve(
      [holder(null), live(profile('gp-tom'))],
      TOM,
      {},
      TOMS_ROW,
    );

    await expect(answer).resolves.toEqual({ id: 'gp-tom', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
  });

  it('takes the oldest when the rows sit on several profiles, and says so (ruling 211c)', async () => {
    const log = logged();
    const { db, answer, inserted } = resolve(
      // As the read hands them back: oldest first.
      [holder(LEA), live(profile('gp-b'), profile('gp-a'))],
      TOM,
      {},
      rows(rosterRow('gp-a', 'Tom', 'Roux'), rosterRow('gp-b', 'Tom', 'Roux')),
    );

    await expect(answer).resolves.toEqual({ id: 'gp-b', created: false, mintReason: null });
    expect(inserted()).toEqual([]);
    expect(log.mock.calls).toEqual([[REFUSED], [`${MATCHED}gp-b (the oldest of 2)`]]);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', ['gp-a', 'gp-b']]]);
    expect(filtersFor(db.from, 'global_persons', 'order')).toEqual([
      ['created_at', { ascending: true }],
    ]);
  });

  it('does not follow a row onto a profile that has another address of its own (ruling 211b)', async () => {
    // Bob typed Tom's name and this address on a row of his own Event, and linked it to his profile.
    const bob = profile('gp-bob', 'bob@example.com');
    const { answer, inserted } = resolve([holder(LEA), live(bob), MINTED], TOM, {}, TOMS_ROW);

    await expect(answer).resolves.toMatchObject({ id: 'gp-new', created: true });
    expect(inserted()).toHaveLength(1);
  });

  it('takes the oldest profile that may be used, past one that may not', async () => {
    const { answer } = resolve(
      [holder(LEA), live(profile('gp-bob', 'bob@example.com'), profile('gp-tom'))],
      TOM,
      {},
      rows(rosterRow('gp-bob', 'Tom', 'Roux'), rosterRow('gp-tom', 'Tom', 'Roux')),
    );

    await expect(answer).resolves.toEqual({ id: 'gp-tom', created: false, mintReason: null });
  });

  it.each([
    [
      'a row of that name the read hands back at another address',
      rows(rosterRow('gp-tom', 'Tom', 'Roux', 'leaX@example.com')),
    ],
    ['a row at the address under another name', rows(rosterRow('gp-lea', 'Léa', 'Roux'))],
  ])('mints for %s', async (_, persons) => {
    const { db, answer, inserted } = resolve([holder(LEA), MINTED], TOM, {}, persons);

    await expect(answer).resolves.toMatchObject({ id: 'gp-new', created: true });
    expect(inserted()).toHaveLength(1);
    // No row counted, so no profile was asked for.
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([]);
  });

  it('mints when the profile of those rows is erased, merged away or deleted', async () => {
    const { db, answer, inserted } = resolve([holder(LEA), live(), MINTED], TOM, {}, TOMS_ROW);

    await expect(answer).resolves.toMatchObject({ id: 'gp-new', created: true });
    expect(inserted()).toHaveLength(1);
    // Live means reachable: not deleted, not merged, account not erased.
    expect(filtersFor(db.from, 'global_persons', 'is')).toEqual(
      expect.arrayContaining([
        ['deleted_at', null],
        ['merged_into_id', null],
        ['account_deleted_at', null],
      ]),
    );
  });

  it.each<[string, Parameters<typeof resolve>[0], Parameters<typeof resolve>[3], string]>([
    [
      'the rows',
      [holder(LEA), MINTED],
      { data: null, error: { message: 'boom' } },
      'roster address link: row read failed: boom',
    ],
    [
      'their profiles',
      [holder(LEA), { data: null, error: { message: 'boom' } }, MINTED],
      TOMS_ROW,
      'roster address link: profile read failed: boom',
    ],
  ])('mints, and says why, when %s cannot be read', async (_, globalPersons, persons, said) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { answer, inserted } = resolve(globalPersons, TOM, {}, persons);

    await expect(answer).resolves.toMatchObject({ id: 'gp-new', created: true });
    expect(inserted()).toHaveLength(1);
    expect(warn.mock.calls).toEqual([[said]]);
  });

  it('reads the linked rows at this address with their names, and the profiles with theirs', async () => {
    const { db, answer } = resolve([holder(LEA), live(profile('gp-tom'))], TOM, {}, TOMS_ROW);

    await answer;

    expect(selectsFor(db.from, 'persons')).toEqual([
      'global_person_id, email, given_name, family_name',
    ]);
    expect(filtersFor(db.from, 'persons', 'ilike')).toEqual([['email', ADDRESS]]);
    expect(filtersFor(db.from, 'persons', 'not')).toEqual([['global_person_id', 'is', null]]);
    expect(selectsFor(db.from, 'global_persons')[1]).toBe('id, email, created_at');
  });

  it('reads no roster row when her own profile was found by its address', async () => {
    const { db, answer } = resolve([holder(LEA)], { givenName: 'Léa', familyName: 'Roux' });

    await answer;

    expect(queriedTables(db.from)).toEqual(['global_persons']);
  });
});

describe('a profile that takes the address while Tom is being minted', () => {
  it('links it when it has his name: two mints of one person at once', async () => {
    const twin = { id: 'gp-tom', email: ADDRESS, given_name: 'Tom', family_name: 'Roux' };
    const { answer, inserted } = resolve([holder(null), TAKEN, holder(twin)], TOM);

    await expect(answer).resolves.toEqual({ id: 'gp-tom', created: false, mintReason: null });
    expect(inserted()).toHaveLength(1);
  });

  it('mints again without the address when it has another name, and says so', async () => {
    const log = logged();
    const { answer, inserted } = resolve([holder(null), TAKEN, holder(LEA), MINTED], TOM);

    await expect(answer).resolves.toEqual({
      id: 'gp-new',
      created: true,
      mintReason: 'first_sighting',
    });
    expect(inserted()).toMatchObject([{ email: ADDRESS }, { email: null }]);
    expect(log.mock.calls).toEqual([[REFUSED]]);
  });

  it('refuses when the address is taken and no profile is found to hold it', async () => {
    const { answer } = resolve([holder(null), TAKEN, holder(null)], TOM);

    const failure = await answer.then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(BadRequestException);
    expect((failure as Error).message).toBe(
      'Email l***@example.com is already linked to another global profile',
    );
  });

  it('refuses a mint that fails without an address to blame', async () => {
    // The address is Léa's, so Tom is minted without it: a failure is then not about the address.
    const { answer } = resolve([holder(LEA), TAKEN], TOM);

    await expect(answer).rejects.toThrow('duplicate key value violates unique constraint');
  });
});

describe('the same name is the same words', () => {
  const name = (givenName: string, familyName: string) => ({ givenName, familyName });

  it.each([
    ['in another case', name('Léa', 'Roux'), name('LÉA', 'ROUX')],
    ['without its accents', name('Léa', 'Roux'), name('Lea', 'Roux')],
    ['in the other order', name('Léa', 'Roux'), name('Roux', 'Léa')],
    ['with a hyphen for a space', name('Marie-Anne', 'Dupont'), name('Marie Anne', 'Dupont')],
    ['with an apostrophe for a space', name("Seán O'Brien", ''), name('Sean', 'O Brien')],
    ['in another script', name('Олег', 'Иванов'), name('ОЛЕГ', 'Иванов')],
  ])('the same name %s', (_, a, b) => {
    expect(sameName(a, b)).toBe(true);
  });

  it.each([
    ['a brother at the family address', name('Tom', 'Roux'), name('Léa', 'Roux')],
    ['a longer family name', name('Léa', 'Roux-Martin'), name('Léa', 'Roux')],
    ['a missing letter', name('Lea', 'Rou'), name('Léa', 'Roux')],
    ['one more word', name('Léa Marie', 'Roux'), name('Léa', 'Roux')],
    ['two names in another script', name('Олег', 'Иванов'), name('Ольга', 'Иванова')],
    // No word at all is no name: an address alone must not link two of them.
    ['no word on either side', name('-', ''), name('', '.')],
  ])('not the same: %s', (_, a, b) => {
    expect(sameName(a, b)).toBe(false);
  });
});
