import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import WorkshopsAdminPage from './page';

/**
 * A placement on the board (slice 2.1, ruling 515). A Workshop runs several sessions, so a POST
 * on the Workshop ADDS a session: a card dragged on the grid must name its session and update
 * it, or every move would leave a copy behind. And an update keeps every field it is not sent:
 * a card dropped on a venue with no rooms sends its room as null, or it keeps a room of the venue
 * it left.
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

const PLACE = {
  venueId: 'v-hall',
  areaId: null,
  startTime: '2026-05-02T12:00:00.000Z',
  endTime: '2026-05-02T13:00:00.000Z',
};

/** The stand-in board's button text: a test's handle, not a word a person reads. */
const handle = (name: string) => name;

// The board draws nothing in jsdom. The stand-in has the board's two kinds of drop: a card
// moved on the grid (it names its session) and a Workshop dragged from the drawer (it names none).
vi.mock('./WorkshopScheduleBoard', () => ({
  WorkshopScheduleBoard: ({
    onPlace,
  }: {
    onPlace: (workshopId: string, sessionId: string | null, placement: typeof PLACE) => void;
  }) => (
    <>
      <button type="button" onClick={() => onPlace('w-1', 's-1', PLACE)}>
        {handle('move s-1')}
      </button>
      <button type="button" onClick={() => onPlace('w-1', null, PLACE)}>
        {handle('add to w-1')}
      </button>
    </>
  ),
}));

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
  [`/api/v1/events/${EVENT_ID}/workshops`]: [],
  [`/api/v1/events/${EVENT_ID}/workshop-breaks`]: [],
  [`/api/v1/events/${EVENT_ID}/workshop-instructor-busy`]: { busy: [] },
};

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<WorkshopsAdminPage />, READS, {
    'PATCH /api/v1/workshop-sessions/s-1': {},
    'POST /api/v1/workshops/w-1/sessions': { id: 's-2' },
  });
};
const press = async (label: string) => {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
/** The body the page sent with its write to `path`. */
const bodyOf = (path: string) =>
  vi.mocked(apiRequest).mock.calls.find(([, p, init]) => p === path && init?.method)?.[2]?.body;

describe('a placement on the board', () => {
  it('moves the card it names by its id, with its whole place', async () => {
    await open();
    await press('Workshop schedule');
    await press('move s-1');
    expect(page.writes()).toEqual(['PATCH /api/v1/workshop-sessions/s-1']);
    expect(bodyOf('/api/v1/workshop-sessions/s-1')).toStrictEqual(PLACE);
  });

  it('adds a session when the drop names none', async () => {
    await open();
    await press('Workshop schedule');
    await press('add to w-1');
    expect(page.writes()).toEqual(['POST /api/v1/workshops/w-1/sessions']);
  });
});
