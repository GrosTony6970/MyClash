/**
 * A Workshop's short description (the line on its catalogue card) and its prerequisites ("bring a
 * mask; you know the basic guards") were stored and could not be edited (ruling 557): the
 * organiser and the Workshop's instructor now write them. A blank box clears a field; a save that
 * does not name a field leaves it as it is.
 *
 * Driven through the controller and the real service over seeded tables. The double ignores
 * projections, so each read's SELECT is asserted.
 */
import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodOrClassValidationPipe } from '../../common/zod-or-class-validation.pipe';
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
  short_description: 'Your first steps with the longsword',
  prerequisites: 'Bring a mask',
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
  auto_check_in: false,
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
    // Paul teaches the Workshop; he is no member of the club.
    global_persons: { rows: [{ id: 'gp-paul', claimed_by_user_id: 'u-paul' }] },
    workshop_instructors: {
      rows: [{ id: 'wi-1', workshop_id: WORKSHOP, global_person_id: 'gp-paul' }],
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

const signedIn = (userId: string) =>
  ({
    headers: { authorization: `Bearer ${userId}` },
    cookies: {},
    identity: { kind: 'claimed', userId, email: null },
  }) as never;
const sent = () => writesTo(db, 'workshops').map((write) => write.row as Record<string, unknown>);

describe('the reads carry both texts', () => {
  it("lists the Workshops with them, read from the Workshop's own columns", async () => {
    const [view] = await controller.list(EVENT, signedIn('u-lead'));

    expect(selectsFor(db.from, 'workshops')[0]).toMatch(/short_description, prerequisites,/);
    expect(view).toMatchObject({
      shortDescription: 'Your first steps with the longsword',
      prerequisites: 'Bring a mask',
    });
  });
});

describe('the organiser writes them', () => {
  it('on create, trimmed, a blank box stored as nothing', async () => {
    await controller.create(
      EVENT,
      { slug: 'a', title: 'A', shortDescription: '  One line ', prerequisites: '   ' },
      signedIn('u-lead'),
    );

    expect(sent()[0]).toMatchObject({ short_description: 'One line', prerequisites: null });
  });

  it('on update: set, cleared by a blank or a null, and kept when not sent', async () => {
    await controller.update(WORKSHOP, { prerequisites: 'A mask and gloves' }, signedIn('u-lead'));
    await controller.update(
      WORKSHOP,
      { shortDescription: '', prerequisites: null },
      signedIn('u-lead'),
    );
    await controller.update(WORKSHOP, { title: 'Longsword, basics' }, signedIn('u-lead'));

    const [first, second, third] = sent();
    expect(first).toMatchObject({ prerequisites: 'A mask and gloves' });
    expect(first).not.toHaveProperty('short_description');
    expect(second).toMatchObject({ short_description: null, prerequisites: null });
    expect(third).not.toHaveProperty('short_description');
    expect(third).not.toHaveProperty('prerequisites');
  });
});

describe("the Workshop's instructor writes them from the dashboard", () => {
  it('sets one and clears the other', async () => {
    await controller.instructorUpdate(
      WORKSHOP,
      { shortDescription: 'Dagger, gently', prerequisites: '' },
      signedIn('u-paul'),
    );

    expect(sent()[0]).toMatchObject({ short_description: 'Dagger, gently', prerequisites: null });
  });
});

describe('the bodies', () => {
  const pipe = new ZodOrClassValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const bodyOf = (handler: 'create' | 'update' | 'instructorUpdate'): ArgumentMetadata => ({
    type: 'body',
    metatype: (
      Reflect.getMetadata('design:paramtypes', WorkshopsController.prototype, handler) as unknown[]
    )[1] as ArgumentMetadata['metatype'],
    data: '',
  });

  it.each(['create', 'update', 'instructorUpdate'] as const)(
    '%s takes both texts and refuses them past their length',
    async (handler) => {
      const base = handler === 'create' ? { slug: 's', title: 'T' } : {};
      const ok = { ...base, shortDescription: 'x'.repeat(200), prerequisites: 'y'.repeat(2000) };
      await expect(pipe.transform(ok, bodyOf(handler))).resolves.toEqual(ok);
      await expect(
        pipe.transform({ ...base, shortDescription: 'x'.repeat(201) }, bodyOf(handler)),
      ).rejects.toThrow(BadRequestException);
      await expect(
        pipe.transform({ ...base, prerequisites: 'y'.repeat(2001) }, bodyOf(handler)),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it("the instructor's body still refuses what an instructor may not change", async () => {
    for (const body of [{ title: 'New title' }, { capacity: 30 }, { status: 'draft' }]) {
      await expect(pipe.transform(body, bodyOf('instructorUpdate'))).rejects.toThrow(
        BadRequestException,
      );
    }
  });
});
