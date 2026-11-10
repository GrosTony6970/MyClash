import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { ApiResult } from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import WorkshopsAdminPage from './page';

/**
 * "Add a person" in a session's roster (operator rulings 535, 536).
 *
 * Saturday's "Longsword basics" has Paul booked. Léa walks up to the desk: the organiser opens the
 * roster, types "lea", clicks her name. She is booked through the organiser's one door, the dialog
 * says where she landed, and the roster is read again. Paul, already on it, is never offered.
 */

const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
}));
const EVENT = vi.hoisted(() => ({ status: 'running' }));
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
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: EVENT.status }] }),
}));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const SESSION = {
  id: 's-1',
  startsAt: null,
  endsAt: null,
  locationLabel: null,
  venueId: null,
  areaId: null,
  venue: null,
  area: null,
  capacity: 20,
  confirmedCount: 1,
  status: 'scheduled',
};
const WORKSHOP = {
  id: 'w-1',
  slug: 'longsword',
  title: 'Longsword basics',
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
  sessions: [SESSION],
};
const PAUL_BOOKING = {
  id: 'e-paul',
  status: 'confirmed',
  waitlistPosition: null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: 'paul-row',
  // Linked: the name's id is the profile's, not the roster row's.
  global_person_id: 'paul-profile',
  guest: false,
  persons: { id: 'paul-profile', givenName: 'Paul', familyName: 'Durand', clubs: null },
};
const PEOPLE = [
  { id: 'lea-row', givenName: 'Léa', familyName: 'Martin', clubLabel: 'Salle Lyon' },
  { id: 'paul-row', givenName: 'Paul', familyName: 'Durand', clubLabel: null },
];

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': { start_date: '2026-05-01', end_date: null, timezone: 'Europe/Paris' },
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [],
  '/api/v1/events/ev1/workshops': [WORKSHOP],
  '/api/v1/events/ev1/workshop-breaks': [],
  '/api/v1/workshop-sessions/s-1/roster': [PAUL_BOOKING],
  '/api/v1/events/ev1/persons': PEOPLE,
};

/** What the booking door answers; a test may hold it back. */
let bookingAnswer: () => Promise<ApiResult<unknown>>;
const SEAT = { ok: true as const, data: { status: 'confirmed', waitlistPosition: null } };

function writes(): string[] {
  return vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method && init.method !== 'GET')
    .map(([, path, init]) => `${init!.method} ${path}`);
}
const rosterReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.endsWith('/roster')).length;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  EVENT.status = 'running';
  SESSION.status = 'scheduled';
  bookingAnswer = async () => SEAT;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method === 'POST') return bookingAnswer();
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openRoster() {
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
  await click(button('Roster'));
}

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
const offered = () =>
  [...document.querySelectorAll('[role="dialog"] li button')].map((b) => b.textContent);

async function click(target: HTMLElement | undefined) {
  expect(target, 'no such button').toBeDefined();
  await act(async () => target!.click());
  await settle();
}

async function search(value: string) {
  await click(button('Add a person'));
  const field = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const said = (role: 'status' | 'alert') =>
  document.querySelector(`[role="dialog"] [role="${role}"]`)?.textContent;

describe('"Add a person" in a session\'s roster', () => {
  it('finds Léa by "lea", books her through the organiser\'s door, says so, reads the roster again', async () => {
    await openRoster();
    await search('lea');
    expect(offered()).toEqual(['Léa MartinSalle Lyon']);

    await click(button('Léa MartinSalle Lyon'));

    expect(writes()).toEqual(['POST /api/v1/workshop-sessions/s-1/enrollments/lea-row']);
    expect(said('status')).toBe('Léa Martin has a seat.');
    expect(rosterReads()).toBe(2);
  });

  it('never offers Paul, who is on the roster already (by his roster row, not his profile)', async () => {
    await openRoster();
    await search('paul');
    expect(offered()).toEqual([]);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      'Nobody of this event matches',
    );
  });

  it('says the place on the waiting list when the session is full (536)', async () => {
    bookingAnswer = async () => ({
      ok: true as const,
      data: { status: 'waitlisted', waitlistPosition: 3 },
    });
    await openRoster();
    await search('lea');
    await click(button('Léa MartinSalle Lyon'));

    expect(said('status')).toBe('Léa Martin is on the waiting list (place 3).');
  });

  it("says a refusal in the reader's words", async () => {
    bookingAnswer = async () => ({
      ok: false as const,
      kind: 'http',
      status: 409,
      code: 'WORKSHOP_ALREADY_BOOKED',
      detail: 'This person already has a place in another session of this workshop.',
      details: null,
      validationErrors: null,
    });
    await openRoster();
    await search('lea');
    await click(button('Léa MartinSalle Lyon'));

    expect(said('alert')).toBe(
      'This person already has a place in another session of this workshop.',
    );
    expect(rosterReads()).toBe(1);
  });

  it('is not offered on a cancelled session', async () => {
    SESSION.status = 'cancelled';
    await openRoster();
    expect(button('Add a person')).toBeUndefined();
  });

  it('is greyed on an archived Event', async () => {
    EVENT.status = 'archived';
    await openRoster();
    expect(button('Add a person')!.disabled).toBe(true);
  });

  it('greys the people offered until the roster is read: it does not yet know who is booked', async () => {
    let release: () => void = () => undefined;
    const reads = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((base, path, init) =>
      path.endsWith('/roster')
        ? new Promise((resolve) => (release = () => resolve(reads(base, path, init))))
        : reads(base, path, init),
    );
    await openRoster();
    await search('paul');

    expect(offered()).toEqual(['Paul Durand']);
    expect(button('Paul Durand')!.disabled).toBe(true);

    await act(async () => release());
    await settle();
    expect(offered()).toEqual([]);
  });

  it('a booking answered after the roster was closed reopens nothing', async () => {
    let answer: () => void = () => undefined;
    bookingAnswer = () => new Promise((resolve) => (answer = () => resolve(SEAT)));
    await openRoster();
    await search('lea');
    await click(button('Léa MartinSalle Lyon'));

    const backdrop = document.querySelector('[role="dialog"]')!.parentElement!;
    await act(async () => backdrop.click());
    await settle();
    await act(async () => answer());
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rosterReads()).toBe(1);
  });
});
