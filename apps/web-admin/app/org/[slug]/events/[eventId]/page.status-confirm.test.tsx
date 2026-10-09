import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type, type OpenedPage } from './archived-page.fixtures';
import EventDetailPage from './page';

/**
 * The Event dashboard holds a second status menu per Tournament. It asks the
 * same question as the Tournaments page before "completed" and "archived"
 * (quick win O1).
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1',
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
// Their own reads are not this test's subject.
vi.mock('./_components/EventLogoCard', () => ({ EventLogoCard: () => null }));
vi.mock('./_components/ReadinessPanel', () => ({
  ReadinessChip: () => null,
  ReadinessPanel: () => null,
}));

const EVENT = { id: EVENT_ID, name: 'Open 2026', slug: 'open-2026', status: 'running' };
const TOURNAMENT = { id: 't-1', slug: 'longsword', name: 'Longsword', status: 'running' };
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: EVENT,
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [TOURNAMENT],
  [`/api/v1/events/${EVENT_ID}/dashboard-stats`]: {
    event: { ...EVENT, startDate: null, endDate: null, city: null, country: null, logoUrl: null },
    totals: {
      tournaments: 1,
      registeredFighters: 0,
      waitlistedFighters: 0,
      maxParticipants: null,
      maxWaitlist: null,
      uniqueFighters: 0,
      uniqueReferees: 0,
      clubsRepresented: 0,
    },
    tournaments: [
      {
        ...TOURNAMENT,
        fighterCount: 0,
        waitlistedCount: 0,
        maxParticipants: null,
        maxWaitlist: null,
        assignedRefereeCount: 0,
      },
    ],
  },
  [`/api/v1/events/${EVENT_ID}/readiness`]: {
    eventId: EVENT_ID,
    eventStatus: 'running',
    tournaments: [],
    checks: [],
    worst: 'ok',
    counts: { ok: 0, warn: 0, critical: 0, info: 0 },
  },
  '/api/v1/organizations/org-1/ai-settings': null,
  [`/api/v1/events/${EVENT_ID}/ai-usage`]: {
    totalSpendEur: 0,
    cap: null,
    remainingEur: null,
    callCount: 0,
  },
};
const SAVE = 'PATCH /api/v1/tournaments/t-1';
/** The body of the one save the page sent. */
const saved = () =>
  vi.mocked(apiRequest).mock.calls.find(([, , init]) => init?.method === 'PATCH')?.[2]?.body;

let page: OpenedPage;
afterEach(() => page.unmount());

const open = async () => {
  page = await openEventPage(<EventDetailPage />, READS, { [SAVE]: {} });
};
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const statusMenu = () =>
  document.body.querySelector<HTMLSelectElement>('select[aria-label="Status"]')!;
const press = async (label: string) => {
  const button = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
};
const pick = async (status: string) => {
  await act(async () => type(statusMenu(), status));
  await page.settle();
};

describe('the status menu of a Tournament on the Event dashboard', () => {
  it('sends "published" at once', async () => {
    await open();
    await pick('published');
    expect(dialog()).toBeNull();
    expect(page.writes()).toEqual([SAVE]);
  });

  it('asks before "completed", and sends nothing on no', async () => {
    await open();
    await pick('completed');
    expect(dialog()?.textContent).toContain('Mark "Longsword" as completed?');
    expect(page.writes()).toEqual([]);
    await press('Cancel');
    expect(page.writes()).toEqual([]);
    expect(statusMenu().value).toBe('running');
  });

  it('sends "completed" on yes', async () => {
    await open();
    await pick('completed');
    await press('Mark as completed');
    expect(page.writes()).toEqual([SAVE]);
    expect(saved()).toEqual({ status: 'completed' });
  });

  it('asks before "archived"', async () => {
    await open();
    await pick('archived');
    expect(dialog()?.textContent).toContain('Archive "Longsword"?');
    expect(page.writes()).toEqual([]);
  });
});
