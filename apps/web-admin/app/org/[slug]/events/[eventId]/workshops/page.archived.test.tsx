import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * The Workshops page of an archived Event (ruling 377). No Workshop is made,
 * edited, published, placed, resized or taken off the board, no break is made,
 * moved or deleted, and nobody is promoted or removed from a roster: the server
 * refuses all of them. A booking is still tied to a person's profile: identity
 * reaches every Event, an archived one too.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/workshops',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const session = (placed: boolean) => ({
  id: placed ? 's-1' : 's-2',
  // 10:00 to 11:00 in Paris, on the Event's only day.
  startsAt: placed ? '2025-05-03T08:00:00+00:00' : null,
  endsAt: placed ? '2025-05-03T09:00:00+00:00' : null,
  locationLabel: null,
  venueId: placed ? 'v-1' : null,
  areaId: null,
  venue: placed ? { id: 'v-1', name: 'Hall' } : null,
  area: null,
  capacity: 2,
  confirmedCount: 1,
  status: 'scheduled',
});
const workshop = (id: string, title: string, placed: boolean) => ({
  id,
  slug: id,
  title,
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
  instructors: [{ globalPersonId: 'gp-1', displayName: 'Ada' }],
  sessions: [session(placed)],
});
const booking = (name: string, status: string, profileId: string | null = null) => ({
  id: `e-${name}`,
  status,
  waitlistPosition: status === 'waitlisted' ? 1 : null,
  enrolledAt: '2025-05-01T08:00:00+00:00',
  personId: `${name}-row`,
  global_person_id: profileId,
  guest: false,
  persons: { id: `${name}-row`, givenName: name, familyName: 'Roux', clubs: null },
});
const ROSTER = [booking('Claire', 'confirmed'), booking('Zoe', 'waitlisted')];
/**
 * Both bookings already tied to a profile, so the roster draws no "Link". The
 * roster has no close button, and "Link" swaps itself for a search and back: the
 * kit would press that pair until it ran out of presses.
 */
const TIED = [booking('Claire', 'confirmed', 'gp-3'), booking('Zoe', 'waitlisted', 'gp-4')];
const ROSTERS_TIED = {
  '/api/v1/workshop-sessions/s-1/roster': TIED,
  '/api/v1/workshop-sessions/s-2/roster': TIED,
};

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': {
    id: 'ev1',
    status: 'archived',
    start_date: '2025-05-03',
    end_date: null,
    timezone: 'Europe/Paris',
  },
  '/api/v1/weapons?active=true': [],
  '/api/v1/events/ev1/instructors': [{ personId: 'gp-2', displayName: 'Bea' }],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [
    { id: 'v-1', name: 'Hall', hosts_workshop: true, venue_areas: null },
  ],
  // One Workshop on the board, one in the "Unscheduled" drawer.
  '/api/v1/events/ev1/workshops': [
    workshop('w-1', 'Saturday longsword', true),
    workshop('w-2', 'Sunday dagger', false),
  ],
  '/api/v1/workshops/w-1': { descriptionMd: null },
  '/api/v1/workshops/w-2': { descriptionMd: null },
  '/api/v1/events/ev1/workshop-breaks': [
    { id: 'b-1', dayIndex: 0, startTime: '12:00', endTime: '13:00', label: 'Lunch', color: null },
  ],
  '/api/v1/workshop-sessions/s-1/roster': ROSTER,
  '/api/v1/workshop-sessions/s-2/roster': ROSTER,
  // What the kit types in the profile search, and what the Link test types.
  '/api/v1/global-persons?q=482916': [],
  '/api/v1/global-persons?q=zoe': [{ id: 'gp-9', display_name: 'Zoe Roux' }],
};
const LINK = 'PATCH /api/v1/global-persons/gp-9/link-workshop-enrollment';

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)!;
async function press(label: string) {
  await act(async () => button(label).click());
  await page.settle();
}

/** A drag carries its data from the card it left to the place it lands. */
function drag(from: Element, to: Element) {
  const data: Record<string, string> = {};
  const dataTransfer = {
    setData: (key: string, value: string) => void (data[key] = value),
    getData: (key: string) => data[key] ?? '',
  };
  for (const [name, target] of [
    ['dragstart', from],
    ['dragover', to],
    ['drop', to],
  ] as const) {
    const event = new MouseEvent(name, { bubbles: true, cancelable: true, clientY: 120 });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    act(() => void target.dispatchEvent(event));
  }
}

const pointer = (name: string, clientY: number) =>
  new MouseEvent(name, { bubbles: true, cancelable: true, clientY });
/** Takes hold of `handle`, pulls it down the board, lets go. Answers what the board showed meanwhile. */
function pull(handle: Element): string {
  act(() => void handle.dispatchEvent(pointer('pointerdown', 100)));
  act(() => void window.dispatchEvent(pointer('pointermove', 100)));
  act(() => void window.dispatchEvent(pointer('pointermove', 400)));
  const shown = document.querySelector('main')!.textContent ?? '';
  act(() => void window.dispatchEvent(pointer('pointerup', 400)));
  return shown;
}

let page: OpenedPage;
beforeEach(() => {
  // jsdom has no ResizeObserver, and the board measures its columns with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  // This test run has no localStorage, and the board keeps its zoom and its hours there.
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  // jsdom makes no object URL, and "Export CSV" (a download, not a save) asks for one.
  URL.createObjectURL = () => 'blob:csv';
  URL.revokeObjectURL = () => undefined;
});
afterEach(() => page.unmount());

describe('the Workshops page of an archived Event', () => {
  it('draws every row it could change', async () => {
    page = await openArchivedPage(<WorkshopsAdminPage />, READS);

    expect(document.body.querySelectorAll('select[aria-label="Workshop status"]')).toHaveLength(2);
    await press('Workshop schedule');
    expect(document.body.textContent).toContain('Saturday longsword');
    expect(document.body.textContent).toContain('Sunday dagger');
    expect(document.body.textContent).toContain('Lunch');
  });

  it('promotes and removes nobody on a roster', async () => {
    page = await openArchivedPage(<WorkshopsAdminPage />, READS);
    await press('Roster');
    expect(document.body.textContent).toContain('Zoe Roux');

    for (const label of ['Promote', 'Remove']) {
      expect(button(label), `no "${label}" button`).toBeDefined();
      for (const b of [...document.body.querySelectorAll('button')]) {
        if (b.textContent === label) await act(async () => b.click());
      }
      await page.settle();
      if (button('Confirm')) await press('Confirm');
    }

    expect(page.writes()).toEqual([]);
  });

  it('still ties a booking to a profile', async () => {
    page = await openArchivedPage(<WorkshopsAdminPage />, READS, { [LINK]: null });
    await press('Roster');
    await press('Link');
    const search = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await act(async () => type(search, 'zoe'));
    // The search waits a quarter of a second after the last key.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));

    await press('Zoe Roux');

    expect(page.writes()).toEqual([LINK]);
  });

  it('lets nothing be dragged, dropped or resized on the board', async () => {
    page = await openArchivedPage(<WorkshopsAdminPage />, READS);
    await press('Workshop schedule');
    const board = document.querySelector('main')!;
    const card = (title: string) =>
      [...board.querySelectorAll('[draggable]')].find((el) => el.textContent?.includes(title))!;
    const column = card('Saturday longsword').parentElement!;

    expect(board.querySelectorAll('[draggable]')).toHaveLength(2);
    expect(board.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    // From the drawer onto the board, along the board, and back to the drawer.
    drag(card('Sunday dagger'), column);
    drag(card('Saturday longsword'), column);
    drag(card('Saturday longsword'), board.querySelector('aside')!);
    await page.settle();
    expect(page.writes()).toEqual([]);

    // Every part of the board is pulled: a card, a break, and any grip on them.
    const still = board.textContent;
    const moved = [...board.querySelectorAll('div, span')].filter((el) => pull(el) !== still);
    await page.settle();
    expect(page.writes()).toEqual([]);
    expect(moved).toEqual([]);
  });

  // Last in the file: with a roster button left live, the kit presses it until
  // the test times out, and a test after this one would open on its leftovers.
  it('sends nothing the server refuses, on the list and on the board', async () => {
    page = await openArchivedPage(<WorkshopsAdminPage />, { ...READS, ...ROSTERS_TIED });

    // One round: the tabs are pressed last, so the board and then the list are both met.
    await page.pressEverything(1);

    expect(page.writes()).toEqual([]);
    // A roster stays open under the kit, and each press waits on it.
  }, 60_000);
});
