import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import WorkshopsAdminPage from './page';

/**
 * What the buttons of a Workshop roster send (operator ruling 214).
 *
 * Claire opens the roster of the Saturday session and clicks "Remove" next to Tom. The page called
 * the participant's own cancel, so Claire lost her seat and Tom kept his. Tom's and Zoé's bookings
 * are linked to their profiles: each entry then carries the profile's id beside the roster row's,
 * and only the roster row names the booking.
 *
 * The page is MOUNTED and clicked: `roster-requests.test.ts` holds the paths, this holds that the
 * page sends them, for the person on the row that was clicked.
 */

// The list's filter hook reads the router, the path and the query.
const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => NAVIGATION.params,
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/org/events/ev1/workshops',
  useSearchParams: () => NAVIGATION.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'running' }] }),
}));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
// The board is another tab of the page; stubbed so its imports stay out of this test.
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const WORKSHOP = {
  id: 'w-1',
  slug: 'saturday',
  title: 'Saturday longsword',
  category: null,
  level: null,
  weapon: null,
  language: 'en',
  capacity: 2,
  durationMinutes: 60,
  status: 'published',
  color: null,
  coverImageUrl: null,
  venueId: null,
  venue: null,
  instructors: [],
  sessions: [
    {
      id: 's-1',
      startsAt: null,
      endsAt: null,
      locationLabel: null,
      venueId: null,
      areaId: null,
      venue: null,
      area: null,
      capacity: 2,
      confirmedCount: 2,
      status: 'scheduled',
    },
  ],
};

const booking = (name: string, status: string, profileId: string | null) => ({
  id: `e-${name}`,
  status,
  waitlistPosition: status === 'waitlisted' ? 1 : null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: `${name}-row`,
  global_person_id: profileId,
  // Tom alone has no account (ruling 264).
  guest: name === 'Tom',
  persons: { id: profileId ?? `${name}-row`, givenName: name, familyName: 'Roux', clubs: null },
});
/** Tom in the MIDDLE: the first or the last row would pass a page that picks the wrong one. */
const ROSTER = [
  booking('Claire', 'confirmed', null),
  booking('Tom', 'confirmed', 'tom-profile'),
  booking('Zoe', 'waitlisted', 'zoe-profile'),
  // A booking whose roster row was deleted: the roster has no name for it.
  { ...booking('Ghost', 'confirmed', null), persons: null },
];

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': { start_date: '2026-05-01', end_date: null, timezone: 'Europe/Paris' },
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [],
  '/api/v1/events/ev1/workshops': [WORKSHOP],
  '/api/v1/events/ev1/workshop-breaks': [],
  '/api/v1/workshop-sessions/s-1/roster': ROSTER,
};

/** Every write the page sent, as `METHOD path`. */
function writes(): string[] {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method && init.method !== 'GET')
    .map(([, path, init]) => `${init!.method} ${path}`);
}

/** Lets every pending fetch, timer and state update land. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  // A read nobody expected throws, and the unhandled rejection fails the run. A write answers ok.
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method && init.method !== 'GET') return { ok: true, data: undefined };
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <WorkshopsAdminPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
  await click(document.body, 'Roster');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function click(scope: ParentNode, label: string) {
  const button = [...scope.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button, `no "${label}" button`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

/** The roster line that shows `name`: the smallest block that holds it and a "Remove" button. */
function lineOf(name: string): Element {
  const line = [...document.body.querySelectorAll('div')]
    .filter(
      (div) =>
        div.textContent?.includes(name) &&
        [...div.querySelectorAll('button')].some((button) => button.textContent === 'Remove'),
    )
    .at(-1);
  expect(line, `no roster line for ${name}`).toBeDefined();
  return line!;
}

const rosterReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.endsWith('/roster')).length;

describe('the roster of a Workshop session', () => {
  it('"Remove" deletes the booking of the person on that line, once confirmed', async () => {
    await click(lineOf('Tom Roux'), 'Remove');
    expect(writes()).toEqual([]);

    await click(document.body, 'Confirm');

    expect(writes()).toEqual(['DELETE /api/v1/workshop-sessions/s-1/enrollments/Tom-row']);
    // The roster is read again, so the person removed leaves the screen.
    expect(rosterReads()).toBe(2);
  });

  it('"Remove" works on a booking the roster has no name for', async () => {
    await click(lineOf('Unknown'), 'Remove');
    await click(document.body, 'Confirm');

    expect(writes()).toEqual(['DELETE /api/v1/workshop-sessions/s-1/enrollments/Ghost-row']);
  });

  it('"Promote" names the roster row of the person on that line', async () => {
    await click(lineOf('Zoe Roux'), 'Promote');

    expect(writes()).toEqual(['POST /api/v1/workshop-sessions/s-1/promote/Zoe-row']);
    expect(rosterReads()).toBe(2);
  });

  it('tags the person no account holds as a guest, beside the name, and nobody else', () => {
    const tagged = ['Claire Roux', 'Tom Roux', 'Zoe Roux', 'Unknown'].filter((name) =>
      [...lineOf(name).querySelectorAll('p span')].some((span) => span.textContent === 'Guest'),
    );

    expect(tagged).toEqual(['Tom Roux']);
  });
});
