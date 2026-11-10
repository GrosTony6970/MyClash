/**
 * A Workshop's auto check-in switch (operator rulings 540, 543): the front desk ticks the
 * Workshop's people on the day they arrive. Off by default; set on the organiser's edit form.
 *
 * The organiser's reads carry it; the public ones never do (it is the organiser's setting, not a
 * thing a visitor reads). A save that does not name it leaves it as it is.
 *
 * Driven through the controller and the real service over seeded tables. The double ignores
 * projections, so each read's SELECT is asserted.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WORKSHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';

const workshop = {
  id: WORKSHOP,
  event_id: EVENT,
  slug: 'longsword',
  title: 'Longsword basics',
  short_description: null,
  description_md: null,
  category: null,
  level: 'all',
  weapon: null,
  language: 'fr',
  capacity: null,
  duration_minutes: null,
  status: 'published',
  sort_order: 0,
  color: null,
  cover_image_url: null,
  venue_id: null,
  auto_check_in: true,
  venues: null,
  workshop_sessions: [],
  workshop_instructors: [],
};

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        {
          id: EVENT,
          slug: 'open',
          timezone: 'Europe/Paris',
          status: 'published',
          organization_id: 'org-a',
        },
      ],
    },
    workshops: { rows: [workshop] },
    workshop_enrollments: { rows: [] },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: 'u-lead', role: 'workshop_lead' }],
    },
  });
  const supabase = { service: db.service, getAuthUser: async (token: string) => ({ id: token }) };
  const privacy = { hiddenWorkshopGlobalPersonIds: async () => new Set<string>() };
  const service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    privacy as never,
    {} as never,
  );
  controller = new WorkshopsController(
    service,
    {} as never,
    supabase as never,
    {} as never,
    {} as never,
    { resolvePersonId: async () => null } as never,
  );
});

/** A signed-in organiser, as the AuthGuard leaves the request. */
const organiser = () =>
  ({
    headers: { authorization: 'Bearer u-lead' },
    cookies: {},
    identity: { kind: 'claimed', userId: 'u-lead', email: null },
  }) as never;
const visitor = () => ({ headers: {}, cookies: {}, identity: { kind: 'anonymous' } }) as never;

describe("the organiser's reads carry the switch", () => {
  it('lists the Workshops with autoCheckIn, read from auto_check_in', async () => {
    const [view] = await controller.list(EVENT, organiser());

    expect(selectsFor(db.from, 'workshops')[0]).toContain('auto_check_in');
    expect(view?.autoCheckIn).toBe(true);
  });

  it('reads one Workshop with autoCheckIn', async () => {
    const view = await controller.getOne(WORKSHOP, organiser());

    expect(selectsFor(db.from, 'workshops').at(-1)).toContain('auto_check_in');
    expect(view.autoCheckIn).toBe(true);
  });
});

describe('the public reads never do', () => {
  it('lists the public Workshops without the switch, and does not read it', async () => {
    const [view] = await controller.listPublic('open', visitor());

    expect(view).toBeDefined();
    expect(view).not.toHaveProperty('autoCheckIn');
    expect(selectsFor(db.from, 'workshops').join('\n')).not.toContain('auto_check_in');
  });
});

describe('saving the switch', () => {
  const sent = () => writesTo(db, 'workshops').map((write) => write.row as Record<string, unknown>);

  it('writes it on create, off when the form does not name it', async () => {
    await controller.create(EVENT, { slug: 'a', title: 'A', autoCheckIn: true }, organiser());
    await controller.create(EVENT, { slug: 'b', title: 'B' }, organiser());

    expect(sent().map((row) => row['auto_check_in'])).toEqual([true, false]);
  });

  it('writes it on update when sent, and leaves it alone when not', async () => {
    await controller.update(WORKSHOP, { autoCheckIn: false }, organiser());
    await controller.update(WORKSHOP, { title: 'Longsword, basics' }, organiser());

    const [first, second] = sent();
    expect(first).toMatchObject({ auto_check_in: false });
    expect(second).not.toHaveProperty('auto_check_in');
  });
});
