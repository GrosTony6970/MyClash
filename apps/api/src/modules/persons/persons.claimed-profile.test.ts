/**
 * Every save of a roster row hands the row's profile to the claim sync (ruling 199): the
 * organiser's add, the edit of a row and the CSV import. Léa already holds her profile, so a row
 * Claire saves with Léa's address must become hers at that moment, not when Léa next presses
 * "This is me". What the sync then claims is tested beside it (`auth/claimed-person-sync.test.ts`).
 *
 * Each door calls it AFTER its own write. The sync reads the roster, so a call made before the row
 * is saved, or before the import links it to its profile, would not find the row.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportDecision } from '@myclash/types';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { syncRowsOfClaimedProfile } from '../auth/claimed-person-sync';
import { CsvImportService } from './csv-import.service';
import type { CreatePersonDto } from './dto/persons.dto';
import { PersonsService } from './persons.service';

vi.mock('../auth/claimed-person-sync', () => ({ syncRowsOfClaimedProfile: vi.fn() }));

const OPEN = 'ev-open';
const HER_PROFILE = 'gp-lea';
const LEA: CreatePersonDto = {
  givenName: 'Léa',
  familyName: 'Martin',
  email: 'lea@example.com',
} as CreatePersonDto;

const sync = vi.mocked(syncRowsOfClaimedProfile);
const resolver = { resolveOrCreateGlobalPerson: vi.fn() };
let db: ReturnType<typeof mockSupabase>;
/** The writes to the roster already made when the sync was called, one list per call. */
let writtenBefore: string[][];

function service(seed: Record<string, TableSeed>): PersonsService {
  db = mockSupabase(seed);
  return new PersonsService(db as never, new CsvImportService(), {} as never, resolver as never);
}

/** The profile each sync call was handed, in call order. */
const handedProfiles = () => sync.mock.calls.map(([, profileId]) => profileId);

beforeEach(() => {
  writtenBefore = [];
  resolver.resolveOrCreateGlobalPerson
    .mockReset()
    .mockResolvedValue({ id: HER_PROFILE, created: false, mintReason: null });
  sync.mockReset().mockImplementation(async () => {
    writtenBefore.push(writesTo(db, 'persons').map((write) => write.op));
  });
});

describe('the organiser adds a row to the roster', () => {
  const emptyRoster: Record<string, TableSeed> = {
    persons: { rows: [], returning: { id: 'p-lea-open', clubs: null } },
    global_persons: { rows: [{ id: HER_PROFILE, club_id: null }] },
  };

  it('hands the profile the resolver found, once the row is saved', async () => {
    await service(emptyRoster).createPerson(OPEN, LEA, 'u-claire');
    expect(handedProfiles()).toEqual([HER_PROFILE]);
    expect(writtenBefore).toEqual([['insert']]);
    expect(sync.mock.calls[0]?.[0]).toMatchObject({ supabase: db });
  });

  it('hands the profile Claire picked herself', async () => {
    const seed = {
      ...emptyRoster,
      global_persons: { rows: [{ id: 'gp-picked', club_id: null }] },
    };
    await service(seed).createPerson(OPEN, { ...LEA, globalPersonId: 'gp-picked' }, 'u-claire');
    expect(handedProfiles()).toEqual(['gp-picked']);
    expect(resolver.resolveOrCreateGlobalPerson).not.toHaveBeenCalled();
  });

  it('hands nothing when the row is not saved', async () => {
    const seed = { ...emptyRoster, persons: [{ data: [] }, { error: { message: 'boom' } }] };
    await expect(service(seed).createPerson(OPEN, LEA, 'u-claire')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('the organiser edits a row of the roster', () => {
  const roster = (globalPersonId: string | null): Record<string, TableSeed> => ({
    persons: { rows: [{ id: 'p-lea-open', global_person_id: globalPersonId, clubs: null }] },
  });

  it('hands the profile of the row, once the edit is saved', async () => {
    await service(roster(HER_PROFILE)).updatePerson('p-lea-open', { email: 'lea@example.com' });
    expect(handedProfiles()).toEqual([HER_PROFILE]);
    expect(writtenBefore).toEqual([['update']]);
  });

  it('hands no profile for a row that has none', async () => {
    await service(roster(null)).updatePerson('p-lea-open', { email: 'lea@example.com' });
    expect(handedProfiles()).toEqual([null]);
  });

  it('hands nothing when the edit is not saved', async () => {
    const seed = { persons: { error: { message: 'boom' } } };
    await expect(
      service(seed).updatePerson('p-lea-open', { email: 'lea@example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('the organiser imports a roster file', () => {
  const FILE = Buffer.from(
    'given_name,family_name,email\nLéa,Martin,lea@example.com\nPaul,Petit,paul@example.com\n',
  );
  const emptyRoster: Record<string, TableSeed> = {
    persons: {
      rows: [],
      returning: (row) => ({ id: `p-${String(row['given_name']).toLowerCase()}` }),
    },
    global_persons: { rows: [{ id: 'gp-picked', club_id: null }] },
  };
  const imported = (decisions: ImportDecision[] = []) =>
    service(emptyRoster).importCsv(OPEN, FILE, 'u-claire', decisions);

  it('hands the profile of each new row, once the row is linked to it', async () => {
    resolver.resolveOrCreateGlobalPerson
      .mockResolvedValueOnce({ id: HER_PROFILE, created: false, mintReason: null })
      .mockResolvedValueOnce({ id: 'gp-paul', created: true, mintReason: 'first_sighting' });
    expect((await imported()).created).toBe(2);
    expect(handedProfiles()).toEqual([HER_PROFILE, 'gp-paul']);
    // Léa's row is inserted, then linked; Paul's the same after hers.
    expect(writtenBefore).toEqual([
      ['insert', 'update'],
      ['insert', 'update', 'insert', 'update'],
    ]);
  });

  it('hands the profile Claire linked a row to in the preview', async () => {
    await imported([{ rowIndex: 0, action: 'link', globalPersonId: 'gp-picked' }]);
    expect(handedProfiles()).toEqual(['gp-picked', HER_PROFILE]);
    expect(writtenBefore[0]).toEqual(['insert', 'update']);
  });

  it('hands nothing for a row whose profile could not be resolved, and imports the rest', async () => {
    resolver.resolveOrCreateGlobalPerson.mockRejectedValueOnce(new Error('boom'));
    expect((await imported()).created).toBe(2);
    expect(handedProfiles()).toEqual([HER_PROFILE]);
  });

  it('hands nothing for a row already on the roster', async () => {
    const seed = {
      ...emptyRoster,
      persons: {
        rows: [
          {
            id: 'p-lea-open',
            event_id: OPEN,
            email: 'lea@example.com',
            given_name: 'Léa',
            family_name: 'Martin',
          },
        ],
        returning: { id: 'p-paul' },
      },
    };
    const report = await service(seed).importCsv(OPEN, FILE, 'u-claire');
    expect(report).toMatchObject({ created: 1, duplicates: [{ row: 2 }] });
    expect(handedProfiles()).toEqual([HER_PROFILE]);
  });
});
