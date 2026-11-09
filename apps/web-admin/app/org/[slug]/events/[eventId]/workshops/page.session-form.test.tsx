import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * The Workshop form lists its sessions (slice 2.1, rulings 515, 524). "Saturday longsword" runs
 * Saturday 10:00 (Paris). The organiser adds Sunday 14:00 in the form, or removes Saturday. The
 * form held one day and time, so a second session could not be made there.
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
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: {
    id: EVENT_ID,
    status: 'running',
    start_date: '2026-05-02',
    end_date: '2026-05-03',
    timezone: 'Europe/Paris',
  },
  [`/api/v1/events/${EVENT_ID}/instructors`]: [],
  '/api/v1/organizations/org-1/venues': [],
  [`/api/v1/events/${EVENT_ID}/workshops`]: [
    {
      id: 'w-1',
      slug: 'w-1',
      title: 'Saturday longsword',
      category: null,
      level: null,
      weapon: null,
      language: 'en',
      capacity: 12,
      durationMinutes: 60,
      status: 'published',
      color: null,
      coverImageUrl: null,
      venueId: null,
      venue: null,
      instructors: [],
      sessions: [
        {
          id: 's-saturday',
          startsAt: '2026-05-02T08:00:00.000Z',
          endsAt: '2026-05-02T09:00:00.000Z',
          locationLabel: null,
          venueId: null,
          areaId: null,
          venue: null,
          area: null,
          capacity: 12,
          confirmedCount: 0,
          status: 'scheduled',
        },
      ],
    },
  ],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  '/api/v1/workshops/w-1': { descriptionMd: null },
  '/api/v1/workshop-sessions/s-saturday/roster': [],
};

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<WorkshopsAdminPage />, READS, {
    'PATCH /api/v1/workshops/w-1': {},
    'POST /api/v1/workshops/w-1/sessions': { id: 's-sunday' },
    'DELETE /api/v1/workshop-sessions/s-saturday': undefined,
  });
};
const press = async (label: string) => {
  const button = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const fields = (label: string) => [
  ...document.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    `[role="dialog"] [aria-label="${label}"]`,
  ),
];
const fill = async (field: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => type(field, value));
  // The time field keeps its value on blur.
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
};
const bodyOf = (method: string, path: string) =>
  vi.mocked(apiRequest).mock.calls.find(([, p, init]) => p === path && init?.method === method)?.[2]
    ?.body;

describe('the Workshop form, its sessions', () => {
  it('shows each session as a line', async () => {
    await open();
    await press('Edit');
    expect(fields('Start time').map((f) => f.value)).toEqual(['10:00']);
  });

  it('adds a session beside the one it has, and leaves that one as it is', async () => {
    await open();
    await press('Edit');
    await press('Add a session');
    await fill(fields('Day (optional)')[1]!, '2026-05-03');
    await fill(fields('Start time')[1]!, '14:00');
    await press('Save');

    expect(page.writes()).toEqual([
      'PATCH /api/v1/workshops/w-1',
      'POST /api/v1/workshops/w-1/sessions',
    ]);
    // 14:00 in Paris, and the Workshop's 60 minutes.
    expect(bodyOf('POST', '/api/v1/workshops/w-1/sessions')).toMatchObject({
      startTime: '2026-05-03T12:00:00.000Z',
      endTime: '2026-05-03T13:00:00.000Z',
    });
  });

  it('removes a session whose line was removed', async () => {
    await open();
    await press('Edit');
    await press('Remove this session');
    await press('Save');
    expect(page.writes()).toEqual([
      'PATCH /api/v1/workshops/w-1',
      'DELETE /api/v1/workshop-sessions/s-saturday',
    ]);
  });
});
