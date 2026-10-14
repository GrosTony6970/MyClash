import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * O6 (ruled 2026-10-14): the workshop board opens on today in the Event's zone when today
 * is one of its days, else on day 1. It always opened on day 1: on Sunday, the organiser
 * moved Saturday's sessions.
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

/** A Workshop with one session placed at 10:00 Paris time on `day`. */
const workshop = (id: string, title: string, day: string) => ({
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
  instructors: [],
  sessions: [
    {
      id: `s-${id}`,
      startsAt: `${day}T08:00:00+00:00`,
      endsAt: `${day}T09:00:00+00:00`,
      locationLabel: null,
      venueId: 'v-1',
      areaId: null,
      venue: { id: 'v-1', name: 'Hall' },
      area: null,
      capacity: 2,
      confirmedCount: 0,
      status: 'scheduled',
    },
  ],
});

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': {
    id: 'ev1',
    status: 'running',
    start_date: '2025-05-03',
    end_date: '2025-05-04',
    timezone: 'Europe/Paris',
  },
  '/api/v1/weapons?active=true': [],
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [
    { id: 'v-1', name: 'Hall', hosts_workshop: true, venue_areas: null },
  ],
  '/api/v1/events/ev1/workshops': [
    workshop('w-1', 'Saturday longsword', '2025-05-03'),
    workshop('w-2', 'Sunday dagger', '2025-05-04'),
  ],
  '/api/v1/workshops/w-1': { descriptionMd: null },
  '/api/v1/workshops/w-2': { descriptionMd: null },
  '/api/v1/events/ev1/workshop-breaks': [],
  '/api/v1/workshop-sessions/s-w-1/roster': [],
  '/api/v1/workshop-sessions/s-w-2/roster': [],
};

let page: OpenedPage;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  // Only the date is fixed: the page's own timers still run.
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  page.unmount();
  vi.useRealTimers();
});

/** The titles of the sessions the board draws. */
async function boardShows(): Promise<string> {
  const tab = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === 'Workshop schedule',
  )!;
  await act(async () => tab.click());
  await page.settle();
  return [...document.body.querySelectorAll('main [draggable]')]
    .map((card) => card.textContent ?? '')
    .join(' | ');
}

describe('the workshop board opens on today', () => {
  it("opens on the Event's second day when today is that day in Paris", async () => {
    // 23:30 UTC on the 3rd is already the 4th in Paris.
    vi.setSystemTime(new Date('2025-05-03T23:30:00Z'));
    page = await openEventPage(<WorkshopsAdminPage />, READS);
    const shown = await boardShows();
    expect(shown).toContain('Sunday dagger');
    expect(shown).not.toContain('Saturday longsword');
  });

  it("names its day tabs in the reader's language", async () => {
    vi.setSystemTime(new Date('2025-05-10T09:00:00Z'));
    page = await openEventPage(<WorkshopsAdminPage />, READS);
    await boardShows();
    const tabs = [...document.body.querySelectorAll('button')].map((b) => b.textContent);
    // The page is in English: the tabs were French ("sam. 03 mai") whatever the language.
    expect(tabs).toContain('Day 1 · Sat 03 May');
    expect(tabs).toContain('Day 2 · Sun 04 May');
  });

  it('opens on day 1 when the Event does not run today', async () => {
    vi.setSystemTime(new Date('2025-05-10T09:00:00Z'));
    page = await openEventPage(<WorkshopsAdminPage />, READS);
    const shown = await boardShows();
    expect(shown).toContain('Saturday longsword');
    expect(shown).not.toContain('Sunday dagger');
  });
});
