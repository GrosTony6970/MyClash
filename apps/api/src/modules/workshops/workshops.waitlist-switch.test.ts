/**
 * A Workshop's waiting-list switch (0280, operator 2026-11-23): off, a full session takes no
 * more bookings. On by default; the organiser sets it on the edit form, the instructor on their
 * own page. A save that does not name it leaves it as it is.
 *
 * Driven through the controller and the real service over seeded tables. The refusal itself is
 * held in enrollment.service.test.ts; the public reads in public-workshops.service.test.ts.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WORKSHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';

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
    workshops: {
      rows: [{ id: WORKSHOP, event_id: EVENT, slug: 'longsword', waitlist_enabled: true }],
    },
    workshop_instructors: { rows: [] },
    global_persons: { rows: [] },
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

/** A signed-in Workshop lead, as the AuthGuard leaves the request. */
const lead = () =>
  ({
    headers: { authorization: 'Bearer u-lead' },
    cookies: {},
    identity: { kind: 'claimed', userId: 'u-lead', email: null },
  }) as never;

const sent = () => writesTo(db, 'workshops').map((write) => write.row as Record<string, unknown>);

describe('saving the waiting-list switch', () => {
  it('writes it on create, on when the form does not name it', async () => {
    await controller.create(EVENT, { slug: 'a', title: 'A', waitlistEnabled: false }, lead());
    await controller.create(EVENT, { slug: 'b', title: 'B' }, lead());

    expect(sent().map((row) => row['waitlist_enabled'])).toEqual([false, true]);
  });

  it("writes it on the organiser's update when sent, and leaves it alone when not", async () => {
    await controller.update(WORKSHOP, { waitlistEnabled: false }, lead());
    await controller.update(WORKSHOP, { title: 'Longsword, basics' }, lead());

    const [first, second] = sent();
    expect(first).toMatchObject({ waitlist_enabled: false });
    expect(second).not.toHaveProperty('waitlist_enabled');
  });

  it("writes it on the instructor's update when sent, and leaves it alone when not", async () => {
    await controller.instructorUpdate(WORKSHOP, { waitlistEnabled: false }, lead());
    await controller.instructorUpdate(WORKSHOP, { level: 'all' }, lead());

    const [first, second] = sent();
    expect(first).toMatchObject({ waitlist_enabled: false });
    expect(second).not.toHaveProperty('waitlist_enabled');
  });
});
