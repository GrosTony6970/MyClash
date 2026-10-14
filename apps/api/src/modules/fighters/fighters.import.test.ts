/**
 * The super admin's bulk import of global profiles (`commitGlobalPersonsImport`): a profile it
 * creates is made outside a roster, so it stays public whatever its draft entries (ruling 176a).
 * An overwrite edits an existing profile and leaves that fact as it was. Its preview and its
 * report say which line of the file a row is and why it was refused, by a code (O17).
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { CsvImportService } from '../persons/csv-import.service';
import { FightersService } from './fighters.service';

const decision = (over: Record<string, unknown>) => ({
  index: 0,
  givenName: 'Jean',
  familyName: 'Dupont',
  isFighter: true,
  ...over,
});

function importing(decisions: Array<Record<string, unknown>>) {
  const db = mockSupabase({
    global_persons: { rows: [], returning: { id: 'gp-new' } },
  });
  const service = new FightersService(db as never, {} as never);
  return { db, run: service.commitGlobalPersonsImport(decisions as never) };
}

describe('the bulk import marks what it creates as made outside a roster (ruling 176a)', () => {
  it('creates the profile made outside a roster', async () => {
    const { db, run } = importing([decision({ action: 'create' })]);
    expect(await run).toMatchObject({ created: 1, failed: [] });
    expect(writesTo(db, 'global_persons')).toEqual([
      expect.objectContaining({
        op: 'insert',
        row: expect.objectContaining({ given_name: 'Jean', made_outside_roster: true }),
      }),
    ]);
  });

  it('leaves an overwritten profile as it was made', async () => {
    const { db, run } = importing([
      decision({ action: 'overwrite', targetGlobalPersonId: 'gp-old' }),
    ]);
    expect(await run).toMatchObject({ updated: 1, failed: [] });
    const [write] = writesTo(db, 'global_persons');
    expect(write).toMatchObject({ op: 'update' });
    expect(write?.row).not.toHaveProperty('made_outside_roster');
  });
});

// O17: the admin page words each refused row from a code; the database's own words are logged.
describe('the bulk import says why a row failed, by a code', () => {
  it('names each refusal by its code', async () => {
    const { run } = importing([
      decision({ index: 2, action: 'create', givenName: ' ' }),
      decision({ index: 3, action: 'create', familyName: '' }),
      decision({ index: 4, action: 'create', dateOfBirth: '15/03/1990' }),
      decision({ index: 5, action: 'overwrite' }),
    ]);
    expect((await run).failed).toEqual([
      { index: 2, reason: 'missing_given_name' },
      { index: 3, reason: 'missing_family_name' },
      { index: 4, reason: 'invalid_date_of_birth', value: '15/03/1990' },
      { index: 5, reason: 'no_profile_to_overwrite' },
    ]);
  });

  it('says "not saved" when the database refuses, and keeps its words off the page', async () => {
    const db = mockSupabase({ global_persons: { error: { message: 'violates unique' } } });
    const service = new FightersService(db as never, {} as never);
    const report = await service.commitGlobalPersonsImport([
      decision({ index: 7, action: 'create' }),
      decision({ index: 8, action: 'overwrite', targetGlobalPersonId: 'gp-old' }),
    ] as never);
    expect(report.failed).toEqual([
      { index: 7, reason: 'not_saved' },
      { index: 8, reason: 'not_saved' },
    ]);
    expect(JSON.stringify(report)).not.toContain('violates');
  });
});

describe('the preview of a Global Profiles file', () => {
  it("gives each row its line in the file, and a refused row's code", async () => {
    const db = mockSupabase({ global_persons: { rows: [] } });
    const service = new FightersService(db as never, new CsvImportService());
    const file = 'given_name,family_name,email,notes\n\nAda,Lovelace,,\nBob,Jones,bob@,\n';
    const preview = await service.previewGlobalPersonsImport(Buffer.from(file));
    expect(preview.rows.map(({ index, status, problem }) => ({ index, status, problem }))).toEqual([
      { index: 3, status: 'ok', problem: null },
      { index: 4, status: 'invalid', problem: { reason: 'invalid_email', value: 'bob@' } },
    ]);
    // O18: this import reads no notes, and says so.
    expect(preview.unknownColumns).toEqual(['notes']);
  });
});
