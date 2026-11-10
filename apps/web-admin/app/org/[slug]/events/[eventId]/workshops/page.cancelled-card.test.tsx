import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * Rulings 526 and 528: "Longsword basics" ran Saturday 10:00 in the Hall, and that session was
 * cancelled. The board still draws it, struck through and named, but it cannot be dragged or
 * resized (a move would tell its people it moved; the server refuses it), and it is no overlap.
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

/** A Workshop with one session at 10:00 Paris time on 3 May, in the Hall. */
const workshop = (id: string, title: string, status: string) => ({
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
      startsAt: '2025-05-03T08:00:00+00:00',
      endsAt: '2025-05-03T09:00:00+00:00',
      locationLabel: null,
      venueId: 'v-1',
      areaId: null,
      venue: { id: 'v-1', name: 'Hall' },
      area: null,
      capacity: 2,
      confirmedCount: 0,
      status,
    },
  ],
});

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': {
    id: 'ev1',
    status: 'running',
    start_date: '2025-05-03',
    end_date: '2025-05-03',
    timezone: 'Europe/Paris',
  },
  '/api/v1/weapons?active=true': [],
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [
    { id: 'v-1', name: 'Hall', hosts_workshop: true, venue_areas: null },
  ],
  // Both at 10:00 in the Hall: Longsword was cancelled, so Dagger has the room. Listed with
  // Longsword last: drawn in list order, the cancelled card used to cover Dagger.
  '/api/v1/events/ev1/workshops': [
    workshop('w-2', 'Dagger', 'scheduled'),
    workshop('w-1', 'Longsword basics', 'cancelled'),
  ],
  '/api/v1/workshops/w-1': { descriptionMd: null },
  '/api/v1/workshops/w-2': { descriptionMd: null },
  '/api/v1/events/ev1/workshop-breaks': [],
  '/api/v1/events/ev1/workshop-instructor-busy': { busy: [] },
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2025-05-03T07:00:00Z'));
});
afterEach(() => {
  page.unmount();
  vi.useRealTimers();
});

describe('a cancelled session on the board', () => {
  it('is drawn struck through and named, fixed in place, and overlaps nothing', async () => {
    page = await openEventPage(<WorkshopsAdminPage />, READS);
    const tab = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Workshop schedule',
    )!;
    await act(async () => tab.click());
    await page.settle();

    const cards = [...document.body.querySelectorAll('main [draggable][role="button"]')];
    const card = (title: string) => cards.find((c) => c.textContent?.includes(title))!;
    const longsword = card('Longsword basics');
    const dagger = card('Dagger');

    expect(longsword.getAttribute('draggable')).toBe('false');
    expect(longsword.textContent).toContain('Cancelled');
    expect(longsword.querySelector('.line-through')?.textContent).toBe('Longsword basics');
    expect(longsword.querySelectorAll('.cursor-ns-resize')).toHaveLength(0);
    expect(dagger.getAttribute('draggable')).toBe('true');
    // Side by side, half each (552): Dagger, live, on the left and first for Tab; Longsword on
    // the right. Neither covers the other.
    expect(dagger.className).toContain('left-0.5 right-1/2');
    expect(longsword.className).toContain('left-1/2 right-0.5');
    expect(cards.indexOf(dagger)).toBeLessThan(cards.indexOf(longsword));
    // Same room, same hour: no red overlap on either, the cancelled one holds no room.
    expect(document.body.querySelectorAll('main [role="button"].ring-danger')).toHaveLength(0);
  });
});
