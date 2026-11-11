/**
 * What the public Workshop page says about its instructors (slice 3.6, rulings 556-560, 575):
 * through the real service over seeded tables. The list reads names only; the page reads each
 * line's bio, club and photo over the profile's; an instructor who hides their Workshops leaves
 * the page with all of it; a draft Event's insider sees the page the public will see.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsService } from './workshops.service';

const OPEN = { userId: 'anonymous', staff: null };
const MEMBER = { userId: 'u-member', staff: null };

const paulProfile = {
  bio: 'Longsword coach since 2008',
  photo_url: '/storage/v1/object/public/fighter-photos/paul.jpg',
  public_visibility: {},
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  clubs: { name: 'Salle Lyon' },
};

const lines = [
  {
    global_person_id: 'gp-paul',
    display_name: 'Paul Martin',
    bio: '15 years of dagger',
    affiliation: null,
    photo_url: null,
    global_persons: paulProfile,
  },
  {
    global_person_id: 'gp-lea',
    display_name: 'Léa Roux',
    bio: 'Rapier since 2015',
    affiliation: 'Guest coach',
    photo_url: '/storage/v1/object/public/workshop-assets/lea.jpg',
    global_persons: { ...paulProfile, bio: 'Léa', clubs: { name: 'Salle Paris' } },
  },
];

const workshop = (eventId: string) => ({
  id: `w-${eventId}`,
  event_id: eventId,
  slug: 'dagger',
  title: 'Dagger intro',
  short_description: null,
  prerequisites: 'Bring a mask',
  description_md: null,
  category: null,
  level: 'all',
  weapon: 'Dagger',
  language: 'fr',
  capacity: null,
  duration_minutes: null,
  status: 'published',
  sort_order: 0,
  color: null,
  cover_image_url: '/storage/v1/object/public/workshop-assets/dagger.png',
  venue_id: null,
  venues: null,
  workshop_sessions: [],
  workshop_instructors: lines,
});

let service: WorkshopsService;

function build(hidden: string[]) {
  const db = mockSupabase({
    events: {
      rows: [
        {
          id: 'e-open',
          slug: 'open',
          timezone: 'Europe/Paris',
          status: 'published',
          organization_id: 'org-a',
        },
        {
          id: 'e-draft',
          slug: 'draft',
          timezone: 'Europe/Paris',
          status: 'draft',
          organization_id: 'org-a',
        },
      ],
    },
    workshops: { rows: [workshop('e-open'), workshop('e-draft')] },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: 'u-member', role: 'read_only' }],
    },
  });
  const supabase = { service: db.service, getAuthUser: async () => null };
  service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    { hiddenWorkshopGlobalPersonIds: async () => new Set(hidden) } as never,
    {} as never,
  );
}

beforeEach(() => build([]));

describe('the public Workshop page says who teaches it (3.6)', () => {
  it("gives each instructor their own bio, club and photo, the Workshop's over the profile's", async () => {
    const view = await service.getPublicWorkshopBySlug('open', 'dagger', OPEN);

    expect(view.instructors).toEqual([
      {
        globalPersonId: 'gp-paul',
        displayName: 'Paul Martin',
        about: {
          bio: '15 years of dagger',
          club: 'Salle Lyon',
          photoUrl: '/storage/v1/object/public/fighter-photos/paul.jpg',
        },
      },
      {
        globalPersonId: 'gp-lea',
        displayName: 'Léa Roux',
        about: {
          bio: 'Rapier since 2015',
          club: 'Guest coach',
          photoUrl: '/storage/v1/object/public/workshop-assets/lea.jpg',
        },
      },
    ]);
    expect(view).toMatchObject({
      weapon: 'Dagger',
      prerequisites: 'Bring a mask',
      coverImageUrl: '/storage/v1/object/public/workshop-assets/dagger.png',
    });
  });

  it('drops an instructor who hides their Workshops, with everything said about them (132)', async () => {
    build(['gp-lea']);
    const view = await service.getPublicWorkshopBySlug('open', 'dagger', OPEN);

    expect(view.instructors.map((i) => i.displayName)).toEqual(['Paul Martin']);
    expect(JSON.stringify(view)).not.toContain('Rapier since 2015');
    expect(JSON.stringify(view)).not.toContain('lea.jpg');
  });

  it("shows a draft Event's insider the page the public will see (575)", async () => {
    const view = await service.getPublicWorkshopBySlug('draft', 'dagger', MEMBER);

    expect(view.instructors[0]?.about?.bio).toBe('15 years of dagger');
  });

  it('keeps the list to names: nothing said about an instructor goes out there', async () => {
    const [listed] = await service.listPublicWorkshops('open', OPEN);

    expect(listed?.instructors).toEqual([
      { globalPersonId: 'gp-paul', displayName: 'Paul Martin' },
      { globalPersonId: 'gp-lea', displayName: 'Léa Roux' },
    ]);
  });
});
