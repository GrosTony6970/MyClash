import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * Deleting a Workshop's session deletes every booking of it, and nothing brings
 * them back. The page has two doors to that delete: the × of a placed card (and
 * the drag back to the drawer, which calls the same handler), and a save of the
 * Workshop's form with no day. Both ask first when somebody is booked (quick
 * win O2).
 *
 * Who is booked is read from the roster at that moment. The page's own list
 * says "0 booked" for every Workshop here, as a list loaded before the first
 * booking does.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/workshops',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
// The board draws nothing in jsdom. Its × and its drawer both call `onUnschedule`
// with the session's id: the stand-in keeps that one call, one button per session.
vi.mock('./WorkshopScheduleBoard', () => ({
  WorkshopScheduleBoard: ({
    workshops,
    onUnschedule,
  }: {
    workshops: Array<{ sessions: Array<{ id: string }> }>;
    onUnschedule?: (sessionId: string) => void;
  }) => (
    <>
      {workshops.flatMap((workshop) =>
        workshop.sessions.map((session) => (
          <button key={session.id} type="button" onClick={() => onUnschedule?.(session.id)}>
            {`unschedule ${session.id}`}
          </button>
        )),
      )}
    </>
  ),
}));

const workshop = (id: string, title: string) => ({
  id,
  slug: id,
  title,
  category: null,
  level: null,
  weapon: null,
  language: 'en',
  capacity: 20,
  durationMinutes: 60,
  status: 'published',
  color: null,
  coverImageUrl: null,
  venueId: null,
  venue: null,
  instructors: [],
  sessions: [
    {
      id: `s-${id}`,
      // No time: the form opens with no day, so its save deletes the session.
      startsAt: null,
      endsAt: null,
      locationLabel: null,
      venueId: null,
      areaId: null,
      venue: null,
      area: null,
      capacity: 20,
      confirmedCount: 0,
      status: 'scheduled',
    },
  ],
});
const booking = (id: string, status: string) => ({
  id,
  status,
  waitlistPosition: null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: `${id}-row`,
  guest: false,
  persons: null,
});

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: {
    id: EVENT_ID,
    status: 'running',
    start_date: '2026-05-01',
    end_date: null,
    timezone: 'Europe/Paris',
  },
  [`/api/v1/events/${EVENT_ID}/instructors`]: [],
  '/api/v1/organizations/org-1/venues': [],
  // The empty one is LAST: a page that read the first Workshop's roster would ask for it too.
  [`/api/v1/events/${EVENT_ID}/workshops`]: [
    workshop('full', 'Saturday longsword'),
    workshop('unread', 'Friday sabre'),
    workshop('empty', 'Sunday dagger'),
  ],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  '/api/v1/workshops/full': { descriptionMd: null },
  '/api/v1/workshops/empty': { descriptionMd: null },
  // Two seats, one on the waiting list, and one refusal, which is no booking.
  '/api/v1/workshop-sessions/s-full/roster': [
    booking('a', 'confirmed'),
    booking('b', 'confirmed'),
    booking('c', 'waitlisted'),
    booking('d', 'refused'),
  ],
  '/api/v1/workshop-sessions/s-empty/roster': [],
};
const UNREAD_ROSTER = '/api/v1/workshop-sessions/s-unread/roster';
const DELETE_FULL = 'DELETE /api/v1/workshop-sessions/s-full';
const DELETE_EMPTY = 'DELETE /api/v1/workshop-sessions/s-empty';

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<WorkshopsAdminPage />, READS, {
    [DELETE_FULL]: undefined,
    [DELETE_EMPTY]: undefined,
    'PATCH /api/v1/workshops/full': {},
    'PATCH /api/v1/workshops/empty': {},
  });
  // One roster cannot be read: the server answers 500.
  const server = vi.mocked(apiRequest).getMockImplementation()!;
  const broken: ApiClient.ApiResult<unknown> = {
    ok: false,
    kind: 'http',
    status: 500,
    detail: 'boom',
    code: null,
    details: null,
    validationErrors: null,
  };
  vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
    path === UNREAD_ROSTER ? broken : server(base, path, init),
  );
};
const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')];
/** The question, told from the Workshop's form, which is a dialog too. */
const question = () =>
  dialogs()
    .filter((dialog) => dialog.textContent?.includes('from the schedule?'))
    .pop();
const form = () => dialogs().find((dialog) => dialog.textContent?.includes('Edit workshop'));
const press = async (label: string, within: ParentNode = document.body, nth = 0) => {
  const button = [...within.querySelectorAll('button')].filter((b) => b.textContent === label)[nth];
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};

describe('the × of a placed Workshop', () => {
  it('deletes the session at once while nobody is booked', async () => {
    await open();
    await press('Workshop schedule');
    await press('unschedule s-empty');
    expect(question()).toBeUndefined();
    expect(page.writes()).toEqual([DELETE_EMPTY]);
  });

  it('asks first when somebody is booked, though the list on the page says nobody is', async () => {
    await open();
    await press('Workshop schedule');
    await press('unschedule s-full');
    expect(page.writes()).toEqual([]);
    expect(question()?.textContent).toContain('Remove "Saturday longsword" from the schedule?');
    expect(question()?.textContent).toContain('Bookings, waiting list included: 3.');
  });

  it('asks without a count when the roster cannot be read', async () => {
    await open();
    await press('Workshop schedule');
    await press('unschedule s-unread');
    expect(page.writes()).toEqual([]);
    expect(question()?.textContent).toContain('Remove "Friday sabre" from the schedule?');
    expect(question()?.textContent).toContain('could not be counted');
  });

  it('deletes nothing on no', async () => {
    await open();
    await press('Workshop schedule');
    await press('unschedule s-full');
    await press('Cancel', question());
    expect(question()).toBeUndefined();
    expect(page.writes()).toEqual([]);
  });

  it('deletes the session on yes', async () => {
    await open();
    await press('Workshop schedule');
    await press('unschedule s-full');
    await press('Remove and delete the bookings', question());
    expect(page.writes()).toEqual([DELETE_FULL]);
  });
});

describe('a save of the form of a Workshop, with no day', () => {
  it('asks first when somebody is booked, and saves nothing on no', async () => {
    await open();
    await press('Edit', document.body, 0);
    await press('Save');
    expect(question()?.textContent).toContain('Remove "Saturday longsword" from the schedule?');
    expect(page.writes()).toEqual([]);
    await press('Cancel', question());
    expect(page.writes()).toEqual([]);
  });

  it('keeps the form open when Escape answers the question', async () => {
    await open();
    await press('Edit', document.body, 0);
    await press('Save');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await page.settle();
    expect(question()).toBeUndefined();
    expect(form()).toBeDefined();
    expect(page.writes()).toEqual([]);
  });

  it('saves and deletes the session on yes', async () => {
    await open();
    await press('Edit', document.body, 0);
    await press('Save');
    await press('Remove and delete the bookings', question());
    expect(page.writes()).toEqual(['PATCH /api/v1/workshops/full', DELETE_FULL]);
  });

  it('saves at once while nobody is booked', async () => {
    await open();
    await press('Edit', document.body, 2);
    await press('Save');
    expect(question()).toBeUndefined();
    expect(page.writes()).toEqual(['PATCH /api/v1/workshops/empty', DELETE_EMPTY]);
  });
});
