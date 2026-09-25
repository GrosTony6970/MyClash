/**
 * public-workshops.service.test.ts
 *
 * Pins the public visibility behaviour:
 *   - the gate is status-only (resolveEventBySlug reads no events-level
 *     privacy column — there is none; reading one used to make every
 *     public call return empty);
 *   - an instructor whose person set hide_workshops_publicly is dropped
 *     from the public DTO, while co-instructors remain.
 */

import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Resp = { data: unknown; error: { message: string } | null };

/** A signed-out reader: these fakes' Event is published, so nobody is asked who they are. */
const ANONYMOUS = { userId: 'anonymous', staff: null };

/** Minimal events+workshops fake for the public list path. */
function buildSupabase(workshopRows: unknown[]) {
  const selectedColumns: string[] = [];
  const eventsApi: Record<string, unknown> = {};
  Object.assign(eventsApi, {
    select: vi.fn((cols: string) => {
      selectedColumns.push(cols);
      return eventsApi;
    }),
    eq: vi.fn(() => eventsApi),
    limit: vi.fn(() => eventsApi),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: { id: 'event-1', status: 'published', organization_id: 'org-1' },
        error: null,
      } as Resp),
    ),
  });
  const workshopsApi: Record<string, unknown> = {};
  Object.assign(workshopsApi, {
    select: vi.fn(() => workshopsApi),
    eq: vi.fn(() => workshopsApi),
    in: vi.fn(() => workshopsApi),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: workshopRows[0] ?? null, error: null } as Resp),
    ),
    order: vi.fn(() =>
      Object.assign(Promise.resolve({ data: workshopRows, error: null } as Resp), {
        order: vi.fn(() => Promise.resolve({ data: workshopRows, error: null } as Resp)),
      }),
    ),
  });
  // confirmed-count query lands on workshop_enrollments
  const enrollApi: Record<string, unknown> = {};
  Object.assign(enrollApi, {
    select: vi.fn(() => enrollApi),
    in: vi.fn(() => enrollApi),
    eq: vi.fn(() => Promise.resolve({ data: [], error: null } as Resp)),
  });
  return {
    service: {
      from: vi.fn((table: string) =>
        table === 'events' ? eventsApi : table === 'workshops' ? workshopsApi : enrollApi,
      ),
    },
    selectedColumns,
  };
}

/** `hidden` is the privacy check's answer; an Error makes the check fail with it. */
const makeSvc = (service: unknown, hidden: Set<string> | Error = new Set()) =>
  new WorkshopsService(
    service as never,
    { scheduleWorkshopSessionStarting: vi.fn() } as never,
    { workshopCancelled: vi.fn() } as never,
    { assertOrgRole: vi.fn() } as never,
    {
      hiddenWorkshopGlobalPersonIds:
        hidden instanceof Error
          ? vi.fn().mockRejectedValue(hidden)
          : vi.fn().mockResolvedValue(hidden),
    } as never,
    { scheduleWorkshopStarting: vi.fn() } as never,
  );

const workshopRow = (instructors: Array<{ global_person_id: string; display_name: string }>) => ({
  id: 'w-1',
  slug: 'longsword',
  title: 'Longsword',
  short_description: null,
  description_md: null,
  category: null,
  level: 'all',
  language: 'fr',
  capacity: null,
  duration_minutes: null,
  status: 'published',
  sort_order: 0,
  venue_id: null,
  venues: null,
  workshop_sessions: [],
  workshop_instructors: instructors,
});

describe('WorkshopsService — public gate', () => {
  it('resolves the event without reading an events-level privacy column', async () => {
    const fake = buildSupabase([]);
    const svc = makeSvc(fake);

    await svc.listPublicWorkshops('fal-2027', ANONYMOUS);

    // The bug we are guarding against: selecting events.hide_workshops_publicly
    // 400s and makes every public call return empty.
    expect(fake.selectedColumns.join(',')).not.toContain('hide_workshops_publicly');
  });

  it('returns [] for an unknown event slug', async () => {
    const fake = buildSupabase([]);
    // Override events.maybeSingle to resolve null.
    (
      fake.service.from('events') as unknown as { maybeSingle: ReturnType<typeof vi.fn> }
    ).maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const svc = makeSvc(fake);
    expect(await svc.listPublicWorkshops('nope', ANONYMOUS)).toEqual([]);
  });
});

describe('WorkshopsService — PostgREST embed shape', () => {
  // Migration 0098's UNIQUE(workshop_id) makes PostgREST embed workshop_sessions
  // as a single object, not an array. The service must not `.map` it blindly.
  it('maps a single-object workshop_sessions embed without throwing', async () => {
    const row = {
      ...workshopRow([]),
      workshop_sessions: {
        id: 's-1',
        starts_at: '2027-06-01T07:00:00.000Z',
        ends_at: '2027-06-01T08:00:00.000Z',
        location_label: null,
        venue_id: null,
        area_id: null,
        status: 'scheduled',
        venues: null,
        venue_areas: null,
      },
    };
    const fake = buildSupabase([row]);
    const svc = makeSvc(fake);

    const [workshop] = await svc.listPublicWorkshops('fal-2027', ANONYMOUS);

    expect(workshop?.sessions).toHaveLength(1);
    expect(workshop?.sessions[0]?.id).toBe('s-1');
  });
});

describe('WorkshopsService — logo mapping', () => {
  it('maps cover_image_url → coverImageUrl on the public DTO', async () => {
    const fake = buildSupabase([
      { ...workshopRow([]), cover_image_url: 'https://cdn.test/workshops/w-1/logo.png' },
    ]);
    const svc = makeSvc(fake);

    const [workshop] = await svc.listPublicWorkshops('fal-2027', ANONYMOUS);

    expect(workshop?.coverImageUrl).toBe('https://cdn.test/workshops/w-1/logo.png');
  });

  it('defaults coverImageUrl to null when the column is absent', async () => {
    const fake = buildSupabase([workshopRow([])]);
    const svc = makeSvc(fake);

    const [workshop] = await svc.listPublicWorkshops('fal-2027', ANONYMOUS);

    expect(workshop?.coverImageUrl).toBeNull();
  });
});

describe('WorkshopsService — instructor privacy', () => {
  it('drops an instructor who hid their workshops, keeping co-instructors', async () => {
    const fake = buildSupabase([
      workshopRow([
        { global_person_id: 'gp-hidden', display_name: 'Hidden Teacher' },
        { global_person_id: 'gp-shown', display_name: 'Shown Teacher' },
      ]),
    ]);
    const svc = makeSvc(fake, new Set(['gp-hidden']));

    const [workshop] = await svc.listPublicWorkshops('fal-2027', ANONYMOUS);

    expect(workshop?.instructors.map((i) => i.displayName)).toEqual(['Shown Teacher']);
  });

  it('keeps all instructors when none opted out', async () => {
    const fake = buildSupabase([
      workshopRow([{ global_person_id: 'gp-1', display_name: 'Teacher One' }]),
    ]);
    const svc = makeSvc(fake, new Set());

    const [workshop] = await svc.listPublicWorkshops('fal-2027', ANONYMOUS);
    expect(workshop?.instructors).toHaveLength(1);
  });

  // Ruling 120: the list and the page fail rather than show an instructor they could not check.
  it('fails the list when the privacy check fails, rather than list everyone', async () => {
    const fake = buildSupabase([
      workshopRow([{ global_person_id: 'gp-1', display_name: 'Teacher One' }]),
    ]);
    const failure = new Error('hidden-workshop privacy read failed: boom');

    await expect(makeSvc(fake, failure).listPublicWorkshops('fal-2027', ANONYMOUS)).rejects.toBe(
      failure,
    );
  });

  it('fails the Workshop page when the privacy check fails, rather than name everyone', async () => {
    const fake = buildSupabase([
      workshopRow([{ global_person_id: 'gp-1', display_name: 'Teacher One' }]),
    ]);
    const failure = new Error('hidden-workshop privacy read failed: boom');

    await expect(
      makeSvc(fake, failure).getPublicWorkshopBySlug('fal-2027', 'longsword', ANONYMOUS),
    ).rejects.toBe(failure);
  });

  it('drops a hidden instructor from the Workshop page too', async () => {
    const fake = buildSupabase([
      workshopRow([
        { global_person_id: 'gp-hidden', display_name: 'Hidden Teacher' },
        { global_person_id: 'gp-shown', display_name: 'Shown Teacher' },
      ]),
    ]);
    const workshop = await makeSvc(fake, new Set(['gp-hidden'])).getPublicWorkshopBySlug(
      'fal-2027',
      'longsword',
      ANONYMOUS,
    );
    expect(workshop.instructors.map((i) => i.displayName)).toEqual(['Shown Teacher']);
  });
});
