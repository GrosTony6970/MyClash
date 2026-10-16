/**
 * An import's "link" decision (O7). The preview offers each row the profile the matcher finds;
 * the organiser's page sends back `{ rowIndex, action: 'link', globalPersonId }`. The id comes
 * from the request: taken as sent, a row was attached to ANY profile it named, and that
 * profile's holder took the row and its address. The commit links a row only to a profile the
 * matcher offers that row now; any other id is resolved as a new row would be.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { CsvImportService } from './csv-import.service';
import { PersonsService } from './persons.service';

vi.mock('../auth/claimed-person-sync', () => ({
  freeRowOfAnotherAddress: vi.fn(),
  syncRowsOfClaimedProfile: vi.fn(),
}));

const FILE = Buffer.from('given_name,family_name,email\nLéa,Martin,lea@example.com\n');
const profile = (id: string, givenName: string, familyName: string) => ({
  id,
  club_id: null,
  given_name: givenName,
  family_name: familyName,
  display_name: `${givenName} ${familyName}`,
  clubs: null,
});
const resolver = { resolveOrCreateGlobalPerson: vi.fn() };
let db: ReturnType<typeof mockSupabase>;

function importing(globalPersonId: string) {
  db = mockSupabase({
    persons: { rows: [], returning: { id: 'p-lea' } },
    global_persons: {
      rows: [profile('gp-lea', 'Léa', 'Martin'), profile('gp-tom', 'Tom', 'Durand')],
    },
  });
  const service = new PersonsService(
    db as never,
    new CsvImportService(),
    {} as never,
    resolver as never,
  );
  return service.importCsv('ev-open', FILE, 'u-claire', [
    { rowIndex: 0, action: 'link', globalPersonId },
  ]);
}

/** The profile each roster write attached the row to. */
const linkedTo = () =>
  writesTo(db, 'persons')
    .map((write) => (write.row as { global_person_id?: string }).global_person_id)
    .filter(Boolean);

beforeEach(() => {
  resolver.resolveOrCreateGlobalPerson
    .mockReset()
    .mockResolvedValue({ id: 'gp-resolved', created: false, mintReason: null });
});

describe('PersonsService.importCsv — a "link" decision', () => {
  it('links the row to the profile the matcher offers it', async () => {
    expect((await importing('gp-lea')).created).toBe(1);

    expect(linkedTo()).toEqual(['gp-lea']);
    expect(resolver.resolveOrCreateGlobalPerson).not.toHaveBeenCalled();
  });

  it('never links the row to a profile the matcher does not offer it: it is resolved instead', async () => {
    expect((await importing('gp-tom')).created).toBe(1);

    expect(linkedTo()).toEqual(['gp-resolved']);
    expect(resolver.resolveOrCreateGlobalPerson).toHaveBeenCalledOnce();
  });

  it('matches on the names it reads', async () => {
    await importing('gp-lea');

    const reads = selectsFor(db.from, 'global_persons').join(' ');
    expect(reads).toMatch(/\bgiven_name\b/);
    expect(reads).toMatch(/\bfamily_name\b/);
  });
});
