/**
 * What the roster import tells the organiser about the rows it skips or refuses (O17): the
 * file's own line, and a reason CODE the page words in her language. The preview and the
 * import word one row the same way, because both ask `importDuplicateReason`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { CsvImportService } from './csv-import.service';
import { PersonsService } from './persons.service';

vi.mock('../auth/claimed-person-sync', () => ({
  freeRowOfAnotherAddress: vi.fn(),
  syncRowsOfClaimedProfile: vi.fn(),
}));

const EVENT = 'ev-open';
const resolver = { resolveOrCreateGlobalPerson: vi.fn() };

function service(seed: Record<string, TableSeed>): PersonsService {
  return new PersonsService(
    mockSupabase(seed) as never,
    new CsvImportService(),
    {} as never,
    resolver as never,
  );
}

/** Léa is on the roster before the import. */
const ROSTER: Record<string, TableSeed> = {
  persons: {
    rows: [
      {
        id: 'p-lea',
        event_id: EVENT,
        email: 'lea@example.com',
        given_name: 'Léa',
        family_name: 'Martin',
      },
    ],
    returning: (row) => ({ id: `p-${String(row['given_name']).toLowerCase()}` }),
  },
  global_persons: { rows: [] },
  clubs: { rows: [] },
};

// Line 2: Léa again (on the roster). Line 3: Paul. Line 4: blank. Line 5: Paul again
// (an earlier row of this file). Line 6: a bad address.
const FILE = Buffer.from(
  [
    'given_name,family_name,email',
    'Léa,Martin,lea@example.com',
    'Paul,Petit,paul@example.com',
    '',
    'Paul,Petit,paul@example.com',
    'Tom,Roux,tom@',
  ].join('\n'),
);

beforeEach(() => {
  resolver.resolveOrCreateGlobalPerson
    .mockReset()
    .mockResolvedValue({ id: 'gp-x', created: true, mintReason: null });
});

describe('the preview of a roster file', () => {
  it('says why each row is skipped, at its own line', async () => {
    const preview = await service(ROSTER).previewImport(EVENT, FILE);
    const skipped = preview.rows
      .filter((row) => row.status !== 'ok')
      .map(({ line, status, reason, value }) => ({ line, status, reason, value }));
    expect(skipped).toEqual([
      { line: 6, status: 'invalid', reason: 'invalid_email', value: 'tom@' },
      { line: 2, status: 'duplicate', reason: 'already_on_roster', value: undefined },
      { line: 5, status: 'duplicate', reason: 'repeated_in_file', value: undefined },
    ]);
    expect(preview.rows.find((row) => row.status === 'ok')).toMatchObject({ index: 1, line: 3 });
  });
});

describe('the import of a roster file', () => {
  it('lists each skipped and refused row with its line and its reason', async () => {
    const report = await service(ROSTER).importCsv(EVENT, FILE, 'u-claire');
    expect(report).toEqual({
      created: 1,
      duplicates: [
        {
          line: 2,
          name: 'Léa Martin',
          reason: 'already_on_roster',
          existingEmail: 'l***@e***.com',
        },
        { line: 5, name: 'Paul Petit', reason: 'repeated_in_file', existingEmail: null },
      ],
      invalid: [{ line: 6, reason: 'invalid_email', value: 'tom@', raw: 'Tom,Roux,tom@' }],
      newClubsForReview: [],
      unmatchableIdentities: [],
    });
  });

  it("says a row was not saved, and keeps the database's words off the page", async () => {
    const seed = { ...ROSTER, persons: [{ data: [] }, { error: { message: 'violates check' } }] };
    const file = Buffer.from('given_name,family_name\nPaul,Petit\n');
    const report = await service(seed).importCsv(EVENT, file, 'u-claire');
    expect(report.invalid).toEqual([{ line: 2, reason: 'not_saved', raw: 'Paul,Petit,' }]);
    expect(JSON.stringify(report)).not.toContain('violates');
  });
});
