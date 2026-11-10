import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, ORG_READ, openEventPage, type, type OpenedPage } from './archived-page.fixtures';
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
// The AI question panel's own reads (`tournaments/:id/query/*`) are not this test's subject:
// only whether the page shows it.
vi.mock('./TournamentQueryPanel', () => ({
  TournamentQueryPanel: () => <section data-testid="ai-question-panel" />,
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
    workshops: { workshops: 3, sessions: 4, seatsTaken: 34, seats: 60, waitlisted: 2 },
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

describe("the Event's zone on the Event dashboard", () => {
  it('shows the zone the Event is on, and saves the one picked', async () => {
    const onTokyo = {
      ...READS,
      [`/api/v1/events/${EVENT_ID}`]: { ...EVENT, timezone: 'Asia/Tokyo' },
    };
    page = await openEventPage(<EventDetailPage />, onTokyo, {
      [`PATCH /api/v1/events/${EVENT_ID}`]: {},
    });
    const zone = document.getElementById('eventTimezone') as HTMLSelectElement;
    expect(zone.value).toBe('Asia/Tokyo');
    await act(async () => type(zone, 'America/New_York'));
    await page.settle();
    expect(page.writes()).toEqual([`PATCH /api/v1/events/${EVENT_ID}`]);
    expect(saved()).toEqual({ timezone: 'America/New_York' });
  });
});

describe("the club's sidebar profile on the Event dashboard", () => {
  const cardLabels = () =>
    [...document.body.querySelectorAll('p.uppercase')].map((p) => p.textContent);
  /** Each card's label with its number, e.g. "Seats taken: 34 / 60". */
  const cards = () =>
    [...document.body.querySelectorAll('p.uppercase')].map(
      (p) => `${p.textContent}: ${p.nextElementSibling?.textContent ?? ''}`,
    );
  const FIGHTER_CARDS = ['Participants', 'Unique fighters', 'Waitlist', 'Unique referees'];
  const WORKSHOP_CARDS = ['Workshops', 'Sessions', 'Seats taken', 'Waitlists'];
  const aiPanel = () => document.body.querySelector('[data-testid="ai-question-panel"]');
  const openFor = async (menuProfile: string, reads: Record<string, unknown> = READS) => {
    page = await openEventPage(<EventDetailPage />, {
      ...reads,
      [ORG_READ]: { id: 'org-1', name: 'Club', menu_profile: menuProfile },
    });
  };
  /** The org's AI key is set, so the AI question panel may show. */
  const WITH_AI = {
    ...READS,
    '/api/v1/organizations/org-1/ai-settings': {
      provider: 'anthropic',
      hasKey: true,
      updatedAt: '2026-11-10T00:00:00Z',
    },
  };

  it('shows the Tournaments card, the fighter cards and the table to a club that shows everything', async () => {
    await openFor('everything');
    expect(cardLabels()).toContain('Tournaments');
    for (const label of FIGHTER_CARDS) expect(cardLabels()).toContain(label);
    for (const label of WORKSHOP_CARDS) expect(cardLabels()).not.toContain(label);
    expect(document.body.querySelector('table')).not.toBeNull();
  });

  it('shows a Workshops-only club Workshop cards in place of the fighter cards, and no table', async () => {
    await openFor('workshops');
    expect(cardLabels()).not.toContain('Tournaments');
    for (const label of FIGHTER_CARDS) expect(cardLabels()).not.toContain(label);
    expect(cards()).toEqual(
      expect.arrayContaining([
        'Workshops: 3',
        'Sessions: 4',
        'Seats taken: 34 / 60',
        'Waitlists: 2',
        'Clubs represented: 0',
      ]),
    );
    expect(document.body.querySelector('table')).toBeNull();
  });

  it('shows seats taken alone when a session has no seat limit', async () => {
    const stats = READS[`/api/v1/events/${EVENT_ID}/dashboard-stats`];
    await openFor('workshops', {
      ...READS,
      [`/api/v1/events/${EVENT_ID}/dashboard-stats`]: {
        ...stats,
        workshops: { ...stats.workshops, seats: null },
      },
    });
    expect(cards()).toContain('Seats taken: 34');
  });

  it('shows the AI question panel to a club that shows everything (ruling 566)', async () => {
    await openFor('everything', WITH_AI);
    expect(aiPanel()).not.toBeNull();
  });

  it('hides the AI question panel from a Workshops-only club (ruling 566)', async () => {
    await openFor('workshops', WITH_AI);
    expect(aiPanel()).toBeNull();
  });
});

describe('the links of a Tournament row on the Event dashboard (O7)', () => {
  it("open each page on that row's Tournament", async () => {
    await open();
    const hrefs = [...document.body.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'));
    for (const page of ['persons', 'pools', 'swiss', 'bracket']) {
      expect(hrefs).toContain(`/org/club/events/ev1/${page}?tournamentId=t-1`);
    }
  });
});
