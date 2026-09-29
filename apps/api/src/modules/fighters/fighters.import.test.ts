/**
 * The super admin's bulk import of global profiles (`commitGlobalPersonsImport`): a profile it
 * creates is made outside a roster, so it stays public whatever its draft entries (ruling 176a).
 * An overwrite edits an existing profile and leaves that fact as it was.
 */
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
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
