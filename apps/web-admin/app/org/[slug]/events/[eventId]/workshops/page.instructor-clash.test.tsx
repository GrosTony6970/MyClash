import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * Rulings 553-555: Paul teaches "Longsword basics" (10:00-11:00, Hall) and "Dagger intro"
 * (10:30-11:30, Gym), and referees a Pool from 10:00. Both cards turn red, each says why, and
 * nothing is refused. When his fights and duties cannot be read, the board says so.
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

const PAUL = { globalPersonId: 'gp-paul', displayName: 'Paul' };
const MARIE = { globalPersonId: 'gp-marie', displayName: 'Marie' };

/** One session on 3 May (Paris = UTC+2), in the venue given. */
const workshop = (
  id: string,
  title: string,
  instructor: typeof PAUL,
  startUtc: string,
  endUtc: string,
  venue: string,
) => ({
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
  instructors: [instructor],
  sessions: [
    {
      id: `s-${id}`,
      startsAt: `2025-05-03T${startUtc}:00+00:00`,
      endsAt: `2025-05-03T${endUtc}:00+00:00`,
      locationLabel: null,
      venueId: venue,
      areaId: null,
      venue: { id: venue, name: venue },
      area: null,
      capacity: 2,
      confirmedCount: 0,
      status: 'scheduled',
    },
  ],
});

const BUSY_PATH = '/api/v1/events/ev1/workshop-instructor-busy';

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
    { id: 'Hall', name: 'Hall', hosts_workshop: true, venue_areas: null },
    { id: 'Gym', name: 'Gym', hosts_workshop: true, venue_areas: null },
  ],
  '/api/v1/events/ev1/workshops': [
    workshop('w-1', 'Longsword basics', PAUL, '08:00', '09:00', 'Hall'),
    workshop('w-2', 'Dagger intro', PAUL, '08:30', '09:30', 'Gym'),
    // Marie teaches alone, after Paul's Pool: no red.
    workshop('w-3', 'Rapier', MARIE, '12:00', '13:00', 'Hall'),
  ],
  '/api/v1/workshops/w-1': { descriptionMd: null },
  '/api/v1/workshops/w-2': { descriptionMd: null },
  '/api/v1/workshops/w-3': { descriptionMd: null },
  '/api/v1/events/ev1/workshop-breaks': [],
  [BUSY_PATH]: {
    busy: [
      {
        personId: 'gp-paul',
        kind: 'referee',
        label: 'Longsword Open · Pool 3',
        startsAt: '2025-05-03T08:00:00.000Z',
        endsAt: '2025-05-03T09:30:00.000Z',
      },
    ],
  },
};

const UNCHECKED = 'Fights and refereeing could not be checked for the instructors.';

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

async function openBoard(reads: Record<string, unknown>) {
  page = await openEventPage(<WorkshopsAdminPage />, reads);
  const tab = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === 'Workshop schedule',
  )!;
  await act(async () => tab.click());
  await page.settle();
  const cards = [...document.body.querySelectorAll('main [draggable][role="button"]')];
  return (title: string) => cards.find((c) => c.textContent?.includes(title))!;
}

describe('an instructor busy elsewhere at the same time', () => {
  it('turns both cards red, each naming the other Workshop and the Pool refereed', async () => {
    const card = await openBoard(READS);

    const longsword = card('Longsword basics');
    const dagger = card('Dagger intro');
    expect(longsword.className).toContain('ring-danger');
    expect(dagger.className).toContain('ring-danger');
    expect(longsword.getAttribute('title')).toBe(
      [
        'Longsword basics',
        'Paul also teaches Dagger intro at this time',
        'Paul referees Longsword Open · Pool 3 at this time',
      ].join('\n'),
    );
    expect(dagger.getAttribute('title')).toContain(
      'Paul also teaches Longsword basics at this time',
    );
    expect(card('Rapier').className).not.toContain('ring-danger');
    // It was read, and it answered: no "could not be checked" line.
    expect(document.body.textContent).not.toContain(UNCHECKED);
    expect(document.body.querySelectorAll('[draggable="true"]').length).toBeGreaterThan(0);
  });

  it('says the fights and refereeing were not checked when they cannot be read', async () => {
    const card = await openBoard({ ...READS, [BUSY_PATH]: FAILED_READ });

    expect(document.body.textContent).toContain(UNCHECKED);
    // The teaching clash needs no read: it still shows.
    expect(card('Dagger intro').getAttribute('title')).toBe(
      ['Dagger intro', 'Paul also teaches Longsword basics at this time'].join('\n'),
    );
  });
});
