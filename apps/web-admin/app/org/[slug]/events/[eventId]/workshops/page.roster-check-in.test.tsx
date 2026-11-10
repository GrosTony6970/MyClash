import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import WorkshopsAdminPage from './page';

/**
 * Who was in the room, ticked from the organiser's roster (operator rulings 539-547).
 *
 * Saturday's "Longsword basics": Claire was ticked at the desk, Tom has a seat, Zoé waits, Ana was
 * refused. A box per seat and waiting-list place, none for Ana (541). A tap sends the tick and
 * patches the row from the answer: the list is not swapped for "Loading…" at every name. A
 * cancelled session shows its ticks and takes none (526); neither does an archived Event. The
 * Workshop's switch (543) is saved by the edit form.
 */
const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
  eventStatus: 'running',
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
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: NAVIGATION.eventStatus }] }),
}));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const SESSION = (status: string) => ({
  id: 's-1',
  // Saturday 10:00-11:00 in Paris: a session with a day, so a save keeps it.
  startsAt: '2026-05-02T08:00:00.000Z',
  endsAt: '2026-05-02T09:00:00.000Z',
  locationLabel: null,
  venueId: null,
  areaId: null,
  venue: null,
  area: null,
  capacity: 2,
  confirmedCount: 2,
  status,
});
const workshop = (sessionStatus = 'scheduled', autoCheckIn = false) => ({
  id: 'w-1',
  slug: 'longsword',
  title: 'Longsword basics',
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
  autoCheckIn,
  instructors: [],
  sessions: [SESSION(sessionStatus)],
});

const booking = (name: string, status: string, checkedInAt: string | null = null) => ({
  id: `e-${name}`,
  status,
  waitlistPosition: status === 'waitlisted' ? 1 : null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: `${name}-row`,
  global_person_id: null,
  guest: false,
  checkedInAt,
  persons: { id: `${name}-row`, givenName: name, familyName: 'Roux', clubs: null },
});
const ROSTER = [
  booking('Claire', 'confirmed', '2026-05-02T07:12:00Z'),
  booking('Tom', 'confirmed'),
  booking('Zoe', 'waitlisted'),
  booking('Ana', 'refused'),
];

let reads: Record<string, unknown>;
/** The answer to the next PUT; a function gets the body. */
let putAnswer: (body: { present: boolean }) => unknown;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  NAVIGATION.eventStatus = 'running';
  reads = {
    '/api/v1/events/ev1': { start_date: '2026-05-02', end_date: null, timezone: 'Europe/Paris' },
    '/api/v1/events/ev1/instructors': [],
    '/api/v1/organizations/slug/org': { id: 'org-1' },
    '/api/v1/organizations/org-1/venues': [],
    '/api/v1/events/ev1/workshops': [workshop()],
    '/api/v1/events/ev1/workshop-breaks': [],
    '/api/v1/workshops/w-1': { descriptionMd: null },
    '/api/v1/workshop-sessions/s-1/roster': ROSTER,
  };
  putAnswer = ({ present }) => ({
    ok: true,
    data: { checkedInAt: present ? '2026-05-02T08:03:00.000Z' : null },
  });
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method === 'PUT') return putAnswer(init.body as { present: boolean }) as never;
    if (init?.method && init.method !== 'GET') return { ok: true, data: { id: 'w-1' } } as never;
    if (path in reads) return { ok: true, data: reads[path] } as never;
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button, `no "${label}" button`).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

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
  await press('Roster');
}

const box = (name: string) =>
  document.body.querySelector<HTMLInputElement>(`input[aria-label="Present: ${name} Roux"]`);

async function tap(name: string) {
  await act(async () => box(name)!.click());
  await settle();
}

const puts = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method === 'PUT')
    .map(([, path, init]) => [path, init!.body]);
const rosterReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path.endsWith('/roster')).length;

describe('ticking people present in the roster', () => {
  it('ticks a seat: one PUT naming the roster row, and the box is ticked', async () => {
    await openRoster();
    expect(box('Tom')!.checked).toBe(false);

    await tap('Tom');

    expect(puts()).toEqual([
      ['/api/v1/workshop-sessions/s-1/enrollments/Tom-row/check-in', { present: true }],
    ]);
    expect(box('Tom')!.checked).toBe(true);
  });

  it('patches the row from the answer: the list is not read again, nor swapped for "Loading…"', async () => {
    await openRoster();
    let answer: () => void = () => undefined;
    putAnswer = () =>
      new Promise((resolve) => {
        answer = () => resolve({ ok: true, data: { checkedInAt: '2026-05-02T08:03:00.000Z' } });
      });

    await tap('Tom');
    // While the tick is out: the other names stay, Tom's box waits.
    expect(document.body.textContent).toContain('Claire Roux');
    expect(box('Tom')!.disabled).toBe(true);
    await act(async () => answer());
    await settle();

    expect(rosterReads()).toBe(1);
    expect(box('Tom')!.checked).toBe(true);
  });

  it('clears a tick: the desk ticked Claire, the organiser takes it back', async () => {
    await openRoster();
    expect(box('Claire')!.checked).toBe(true);

    await tap('Claire');

    expect(puts()).toEqual([
      ['/api/v1/workshop-sessions/s-1/enrollments/Claire-row/check-in', { present: false }],
    ]);
    expect(box('Claire')!.checked).toBe(false);
  });

  it('draws a box for a waiting-list place, and none for a refused person (541)', async () => {
    await openRoster();

    expect(box('Zoe')).not.toBeNull();
    expect(box('Ana')).toBeNull();
  });

  it('says a refusal in the reader’s words, and leaves the box as it was', async () => {
    await openRoster();
    putAnswer = () => ({
      ok: false,
      kind: 'http',
      status: 409,
      code: 'CHECK_IN_REFUSED_BOOKING',
      message: 'A refused person cannot be ticked present.',
    });

    await tap('Tom');

    expect(document.body.textContent).toContain('A refused person cannot be ticked present.');
    expect(box('Tom')!.checked).toBe(false);
  });

  it('shows a cancelled session’s ticks, and takes none (526)', async () => {
    reads['/api/v1/events/ev1/workshops'] = [workshop('cancelled')];
    await openRoster();

    expect(box('Claire')!.checked).toBe(true);
    expect(box('Claire')!.disabled).toBe(true);
    expect(box('Tom')!.disabled).toBe(true);
  });

  it('takes no tick on an archived Event', async () => {
    NAVIGATION.eventStatus = 'archived';
    await openRoster();

    expect(box('Tom')!.disabled).toBe(true);
  });
});

describe("the Workshop's auto check-in switch (543)", () => {
  const sent = (method: string) =>
    vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === method)?.[2]?.body as
      Record<string, unknown> | undefined;

  it('keeps the switch on through an edit that does not touch it', async () => {
    reads['/api/v1/events/ev1/workshops'] = [workshop('scheduled', true)];
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

    await press('Edit');
    await press('Save');

    expect(sent('PATCH')).toMatchObject({ autoCheckIn: true });
  });
});
