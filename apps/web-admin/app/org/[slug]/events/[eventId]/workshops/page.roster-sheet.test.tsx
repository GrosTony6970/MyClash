import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import WorkshopsAdminPage from './page';

/**
 * "Print" and "Export CSV" on a session's roster (operator ruling 537). `roster-sheet.test.ts`
 * holds the sheet; this holds that the roster dialog hands it the session on screen, waits while
 * that roster is read, and offers nothing when nobody would be on the sheet.
 */

const NAVIGATION = vi.hoisted(() => ({
  params: { slug: 'org', eventId: 'ev1' },
  router: { replace: () => undefined, push: () => undefined },
  search: new URLSearchParams(),
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
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'running' }] }),
}));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('./WorkshopScheduleBoard', () => ({ WorkshopScheduleBoard: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const WORKSHOP = {
  id: 'w-1',
  slug: 'longsword',
  title: 'Longsword basics',
  category: null,
  level: null,
  weapon: null,
  language: 'en',
  capacity: 20,
  durationMinutes: 90,
  status: 'published',
  color: null,
  coverImageUrl: null,
  venueId: null,
  venue: null,
  instructors: [{ globalPersonId: 'gp-1', displayName: 'Paul Roux' }],
  sessions: [
    {
      id: 's-1',
      startsAt: '2026-11-14T09:00:00+00:00',
      endsAt: '2026-11-14T10:30:00+00:00',
      locationLabel: null,
      venueId: null,
      areaId: null,
      venue: null,
      area: null,
      capacity: 20,
      confirmedCount: 1,
      status: 'scheduled',
    },
  ],
};
const booking = (name: string, status: string) => ({
  id: `e-${name}`,
  status,
  waitlistPosition: null,
  enrolledAt: '2026-05-01T08:00:00+00:00',
  personId: `${name}-row`,
  global_person_id: null,
  guest: false,
  persons: { id: `${name}-row`, givenName: name, familyName: 'Martin', clubs: null },
});

let roster: unknown[];
const READS: Record<string, unknown> = {
  '/api/v1/events/ev1': { start_date: '2026-11-14', end_date: null, timezone: 'Europe/Paris' },
  '/api/v1/events/ev1/instructors': [],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/venues': [],
  '/api/v1/events/ev1/workshops': [WORKSHOP],
  '/api/v1/events/ev1/workshop-breaks': [],
};

let printed: string;
let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  roster = [booking('Léa', 'confirmed')];
  printed = '';
  vi.stubGlobal('open', () => ({
    document: { write: (html: string) => (printed = html), close: () => undefined },
    focus: () => undefined,
    print: () => undefined,
  }));
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path.endsWith('/roster')) return { ok: true, data: roster };
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
  await act(async () => button('Roster')!.click());
  await settle();
}

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label));

describe("a session's roster prints and exports", () => {
  it('prints the sheet of the session on screen: its Workshop, time, instructors, people', async () => {
    await openRoster();
    await act(async () => button('Print')!.click());

    for (const text of ['Longsword basics', '10:00', 'Paul Roux', 'Martin Léa', 'Present']) {
      expect(printed).toContain(text);
    }
  });

  it('greys both while the roster is read', async () => {
    let release: () => void = () => undefined;
    const reads = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation((base, path, init) =>
      path.endsWith('/roster')
        ? new Promise((resolve) => (release = () => resolve(reads(base, path, init))))
        : reads(base, path, init),
    );
    // The page's first read of the roster, then a second one: the first answer is on screen.
    await openRoster();
    await act(async () => release());
    await settle();
    await act(async () => button('Roster')!.click());

    expect(button('Print')!.disabled).toBe(true);
    expect(button('Export CSV')!.disabled).toBe(true);
    await act(async () => release());
    await settle();
    expect(button('Print')!.disabled).toBe(false);
  });

  it('offers neither when nobody would be on the sheet: refused people are left out', async () => {
    roster = [booking('Marc', 'refused')];
    await openRoster();

    expect(button('Print')).toBeUndefined();
    expect(button('Export CSV')).toBeUndefined();
  });
});
