/**
 * The club-role order has one owner, `roleAtLeast`: `assertOrgRole` refuses by it, and the
 * Tournament read says by it whether its reader may change the settings (ruling 101).
 *
 * The `role` column is TEXT with no CHECK (0001_init.sql), so an unknown string can reach the
 * compare: it must lose, whatever the bar.
 */
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase } from '../../common/testing/supabase-chain';
import { OrganizationsService, roleAtLeast } from './organizations.service';

const ORDER = ['read_only', 'scorekeeper', 'referee', 'workshop_lead', 'editor', 'admin', 'owner'];

describe('roleAtLeast', () => {
  it.each(ORDER.flatMap((min, at) => ORDER.map((role, i) => [role, min, i >= at] as const)))(
    '%s against the bar %s is %s',
    (role, min, expected) => {
      expect(roleAtLeast(role, min as never)).toBe(expected);
    },
  );

  it.each([undefined, null, '', 'Admin', 'super_admin', ' admin'])(
    'refuses a role the order does not hold (%j)',
    (role) => {
      expect(roleAtLeast(role, 'read_only')).toBe(false);
    },
  );

  it('refuses everyone against a bar the order does not hold', () => {
    // The one cast: the type admits no such bar, but the old compare let everyone through one.
    expect(roleAtLeast('owner', 'super_admin' as never)).toBe(false);
  });
});

describe('assertOrgRole', () => {
  const service = (role: string) => {
    const db = mockSupabase({
      organization_members: {
        rows: [
          { organization_id: 'org-1', user_id: 'u-lea', role },
          { organization_id: 'org-1', user_id: 'u-other', role: 'owner' },
          { organization_id: 'org-2', user_id: 'u-lea', role: 'owner' },
        ],
      },
    });
    return { db, orgs: new OrganizationsService(db as never) };
  };

  it("answers the member's own role in that club", async () => {
    const { db, orgs } = service('editor');

    await expect(orgs.assertOrgRole('org-1', 'u-lea', 'scorekeeper')).resolves.toBe('editor');
    expect(filtersFor(db.from, 'organization_members', 'eq')).toEqual([
      ['organization_id', 'org-1'],
      ['user_id', 'u-lea'],
    ]);
  });

  it('refuses a role below the bar', async () => {
    const { orgs } = service('editor');

    await expect(orgs.assertOrgRole('org-1', 'u-lea', 'admin')).rejects.toThrow(
      'Requires admin role or higher',
    );
  });

  it('refuses a role the order does not hold, even at the lowest bar', async () => {
    const { orgs } = service('Admin');

    await expect(orgs.assertOrgRole('org-1', 'u-lea', 'read_only')).rejects.toThrow(
      'Requires read_only role or higher',
    );
  });
});
