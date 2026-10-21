/**
 * `GET /tournaments/:id` says whether its reader may change the Tournament's settings
 * (`viewer_may_edit`, rulings 90 and 101): the settings page closes every Save for a reader who
 * may not, instead of letting the Save answer 403.
 *
 * The story: Léa scores for her club and is an admin of another one. She opens a Tournament of her
 * own club: she may read it, not change it. Her club's admin opens the same Tournament: he may.
 * A read_only member is refused the read itself, as today.
 *
 * Over the real controller, service and org-role check (`OrganizationsService`) on seeded tables.
 */
import { describe, expect, it } from 'vitest';
import { filtersFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { harness, ON_TF_1_0_0, type Row } from './rules-write.fixtures';

/** One member of the Tournament's club (`org-1`) per role, each with its own MARKER id. */
const MEMBERS = [
  ['u-owner', 'owner'],
  ['u-admin', 'admin'],
  ['u-editor', 'editor'],
  ['u-lead', 'workshop_lead'],
  ['u-referee', 'referee'],
  ['u-scorer', 'scorekeeper'],
  ['u-read', 'read_only'],
] as const;

function opened() {
  const h = harness(
    ON_TF_1_0_0,
    {},
    {
      organization_members: {
        rows: [
          ...MEMBERS.map(([user_id, role]) => ({ organization_id: 'org-1', user_id, role })),
          // Léa scores here and is an admin of another club.
          { organization_id: 'org-1', user_id: 'u-lea', role: 'scorekeeper' },
          { organization_id: 'org-2', user_id: 'u-lea', role: 'admin' },
        ],
      },
    },
    { orgs: (db) => new OrganizationsService(db as never) },
  );
  return { ...h, read: async (userId: string) => (await h.getTournament(userId)) as Row };
}

describe('the Tournament read says whether its reader may change the settings', () => {
  it.each([
    ['u-owner', true],
    ['u-admin', true],
    ['u-editor', false],
    ['u-lead', false],
    ['u-referee', false],
    ['u-scorer', false],
  ])('%s: %s', async (userId, mayEdit) => {
    const answer = await opened().read(userId);

    expect(answer['id']).toBe('t1');
    expect(answer['viewer_may_edit']).toBe(mayEdit);
  });

  it("reads the role in the Tournament's own club, not the reader's other one", async () => {
    const page = opened();

    expect((await page.read('u-lea'))['viewer_may_edit']).toBe(false);
    expect(filtersFor(page.db.from, 'organization_members', 'eq')).toEqual([
      ['organization_id', 'org-1'],
      ['user_id', 'u-lea'],
    ]);
  });

  it('refuses a read_only member the read itself, as before', async () => {
    await expect(opened().read('u-read')).rejects.toThrow('Requires scorekeeper role or higher');
  });

  it('refuses a reader who is no member', async () => {
    await expect(opened().read('u-stranger')).rejects.toThrow(
      'You are not a member of this organization',
    );
  });
});
