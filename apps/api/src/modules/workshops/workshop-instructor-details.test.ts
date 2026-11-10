/**
 * What a Workshop says about one of its instructors, over their profile (rulings 556, 558-560,
 * 563): who may read and write a line, what the read shows, and what a save writes.
 *
 * Paul and Marie teach "Longsword basics". Lea is the club's Workshop lead. Zoe is a stranger.
 */
import 'reflect-metadata';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZodOrClassValidationPipe } from '../../common/zod-or-class-validation.pipe';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopInstructorDetailsController } from './workshop-instructor-details.controller';
import { WorkshopInstructorDetailsService } from './workshop-instructor-details.service';
import { WorkshopsService } from './workshops.service';

const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WORKSHOP = 'aaaaaaaa-0000-4000-8000-00000000000a';
const PAUL = 'gp-paul';
const MARIE = 'gp-marie';

const paulsProfile = {
  bio: 'Fiore since 2010',
  photo_url: '/storage/v1/object/public/fighter-photos/fighters/gp-paul/photo-1.jpg',
  public_visibility: { bio: false },
  clubs: { name: 'Salle Lyon' },
};

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopInstructorDetailsController;

function setUp(paulsLine: Record<string, unknown> | null) {
  db = mockSupabase({
    events: { rows: [{ id: EVENT, status: 'published', organization_id: 'org-a' }] },
    workshops: { rows: [{ id: WORKSHOP, event_id: EVENT }] },
    organization_members: {
      rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'workshop_lead' }],
    },
    global_persons: {
      rows: [
        { id: PAUL, claimed_by_user_id: 'u-paul' },
        { id: MARIE, claimed_by_user_id: 'u-marie' },
      ],
    },
    workshop_instructors: {
      rows: [
        ...(paulsLine
          ? [{ id: 'wi-paul', workshop_id: WORKSHOP, global_person_id: PAUL, ...paulsLine }]
          : []),
        {
          id: 'wi-marie',
          workshop_id: WORKSHOP,
          global_person_id: MARIE,
          bio: null,
          affiliation: null,
          photo_url: null,
          global_persons: null,
        },
      ],
    },
  });
  const supabase = { service: db.service, getAuthUser: async (token: string) => ({ id: token }) };
  const workshops = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    {} as never,
    {} as never,
  );
  controller = new WorkshopInstructorDetailsController(
    new WorkshopInstructorDetailsService(supabase as never, workshops),
    supabase as never,
  );
}

const signedIn = (userId: string) =>
  ({
    headers: { authorization: `Bearer ${userId}` },
    cookies: {},
    identity: { kind: 'claimed', userId, email: null },
  }) as never;
const lineWrites = () =>
  writesTo(db, 'workshop_instructors').map((write) => write.row as Record<string, unknown>);

beforeEach(() =>
  setUp({
    bio: null,
    affiliation: 'Salle Lyon, Thursday group',
    photo_url: null,
    global_persons: paulsProfile,
  }),
);

describe('who may read and write a line (558)', () => {
  it('Paul, his own line', async () => {
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-paul'))).resolves.toBeDefined();
    await expect(
      controller.update(WORKSHOP, PAUL, { bio: 'Mine' }, signedIn('u-paul')),
    ).resolves.toBeDefined();
  });

  it("the Workshop lead, any instructor's line", async () => {
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-lea'))).resolves.toBeDefined();
    await expect(
      controller.update(WORKSHOP, MARIE, { club: 'Salle Paris' }, signedIn('u-lea')),
    ).resolves.toBeDefined();
  });

  it("not Marie on Paul's line, though she teaches the same Workshop", async () => {
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-marie'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      controller.update(WORKSHOP, PAUL, { bio: 'Not mine' }, signedIn('u-marie')),
    ).rejects.toThrow(ForbiddenException);
    expect(lineWrites()).toEqual([]);
  });

  it('a stranger is refused before the line is read: no answer says who teaches', async () => {
    setUp(null);
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-zoe'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(selectsFor(db.from, 'workshop_instructors')).toEqual([]);
  });

  it('a line that does not exist is a 404 to the lead', async () => {
    setUp(null);
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-lea'))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      controller.update(WORKSHOP, PAUL, { bio: 'x' }, signedIn('u-lea')),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('the read: this Workshop over the profile (563)', () => {
  it("reads the line's three columns and the profile it falls back to", async () => {
    await controller.get(WORKSHOP, PAUL, signedIn('u-lea'));
    expect(selectsFor(db.from, 'workshop_instructors')).toEqual([
      'bio, affiliation, photo_url, global_persons ( bio, photo_url, public_visibility, clubs ( name ) )',
    ]);
  });

  it("gives the lead the line and the profile's club and photo, never a private bio", async () => {
    await expect(controller.get(WORKSHOP, PAUL, signedIn('u-lea'))).resolves.toEqual({
      override: { bio: null, club: 'Salle Lyon, Thursday group', photoUrl: null },
      profile: { bio: null, club: 'Salle Lyon', photoUrl: paulsProfile.photo_url },
    });
  });

  it('gives Paul his own private bio as the hint', async () => {
    const view = await controller.get(WORKSHOP, PAUL, signedIn('u-paul'));
    expect(view.profile.bio).toBe('Fiore since 2010');
  });

  it('gives the lead a bio the profile shows', async () => {
    setUp({
      bio: null,
      affiliation: null,
      photo_url: null,
      global_persons: { ...paulsProfile, public_visibility: {} },
    });
    const view = await controller.get(WORKSHOP, PAUL, signedIn('u-lea'));
    expect(view.profile.bio).toBe('Fiore since 2010');
  });
});

describe('a save writes only the boxes sent', () => {
  it('a bio, trimmed; the club line left as it is', async () => {
    const answer = await controller.update(
      WORKSHOP,
      PAUL,
      { bio: '  Ten years of Fiore ' },
      signedIn('u-paul'),
    );
    expect(lineWrites()).toEqual([{ bio: 'Ten years of Fiore' }]);
    // The answer reads the three columns back, the club line from the line's affiliation.
    expect(selectsFor(db.from, 'workshop_instructors')).toContain('bio, affiliation, photo_url');
    expect(answer).toMatchObject({ club: 'Salle Lyon, Thursday group' });
  });

  it("the club line into the line's affiliation; a blank bio and a null clear", async () => {
    await controller.update(WORKSHOP, PAUL, { bio: '   ', club: 'Salle Paris' }, signedIn('u-lea'));
    await controller.update(WORKSHOP, PAUL, { club: null }, signedIn('u-lea'));
    expect(lineWrites()).toEqual([
      { bio: null, affiliation: 'Salle Paris' },
      { affiliation: null },
    ]);
  });

  it('nothing sent writes nothing and answers the line as stored', async () => {
    await expect(controller.update(WORKSHOP, PAUL, {}, signedIn('u-lea'))).resolves.toEqual({
      bio: null,
      club: 'Salle Lyon, Thursday group',
      photoUrl: null,
    });
    expect(lineWrites()).toEqual([]);
  });
});

describe("the organiser's Workshop list says which lines carry details (561)", () => {
  it('reads the three columns and answers a flag, never their values', async () => {
    db = mockSupabase({
      events: { rows: [{ id: EVENT, status: 'published', organization_id: 'org-a' }] },
      organization_members: {
        rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'workshop_lead' }],
      },
      workshop_enrollments: { rows: [] },
      workshops: {
        rows: [
          {
            id: WORKSHOP,
            event_id: EVENT,
            title: 'Longsword basics',
            workshop_sessions: [],
            workshop_instructors: [
              {
                global_person_id: PAUL,
                display_name: 'Paul',
                bio: null,
                affiliation: 'Salle Lyon',
                photo_url: null,
              },
              {
                global_person_id: MARIE,
                display_name: 'Marie',
                bio: null,
                affiliation: null,
                photo_url: null,
              },
            ],
          },
        ],
      },
    });
    const workshops = new WorkshopsService(
      { service: db.service, getAuthUser: async (token: string) => ({ id: token }) } as never,
      {} as never,
      {} as never,
      new OrganizationsService({ service: db.service } as never),
      {} as never,
      {} as never,
    );
    const [view] = await workshops.listWorkshops(EVENT, 'u-lea');

    expect(selectsFor(db.from, 'workshops')[0]).toMatch(
      /workshop_instructors \( global_person_id, display_name, bio, affiliation, photo_url \)/,
    );
    expect(view!.instructors).toEqual([
      { globalPersonId: PAUL, displayName: 'Paul', hasDetails: true },
      { globalPersonId: MARIE, displayName: 'Marie', hasDetails: false },
    ]);
  });
});

describe('the body', () => {
  const pipe = new ZodOrClassValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const body: ArgumentMetadata = {
    type: 'body',
    metatype: (
      Reflect.getMetadata(
        'design:paramtypes',
        WorkshopInstructorDetailsController.prototype,
        'update',
      ) as unknown[]
    )[2] as ArgumentMetadata['metatype'],
    data: '',
  };

  it('takes both boxes up to their limits and refuses them past', async () => {
    const ok = { bio: 'b'.repeat(2000), club: 'c'.repeat(200) };
    await expect(pipe.transform(ok, body)).resolves.toEqual(ok);
    await expect(pipe.transform({ bio: 'b'.repeat(2001) }, body)).rejects.toThrow(
      BadRequestException,
    );
    await expect(pipe.transform({ club: 'c'.repeat(201) }, body)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a photo link or a name: the photo has its own upload', async () => {
    for (const sent of [{ photoUrl: '/x.png' }, { displayName: 'Paul' }, { photo_url: null }]) {
      await expect(pipe.transform(sent, body)).rejects.toThrow(BadRequestException);
    }
  });
});
