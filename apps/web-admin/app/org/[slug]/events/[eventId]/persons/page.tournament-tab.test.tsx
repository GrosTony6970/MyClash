import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PersonsPage from './page';

/**
 * The roster's Tournament tab is in the address (O7): a dashboard row's link opens the
 * roster on its Tournament, and a refresh keeps it. Opened bare, the roster shows every
 * Tournament, even when another page remembers one (operator, 2026-10-14). The waiting
 * list's switch rewrote the address with its path alone, and threw the tab away.
 */

// One router for every render, as Next gives.
const NAVIGATION = vi.hoisted(() => {
  const replaced: string[] = [];
  return {
    search: new URLSearchParams(),
    replaced,
    router: { replace: (to: string) => replaced.push(to), push: () => undefined },
  };
});
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/org/events/ev1/persons',
  useSearchParams: () => NAVIGATION.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ events: [{ id: 'ev1', status: 'draft' }] }),
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const person = (id: string, givenName: string, familyName: string) => ({
  id,
  givenName,
  familyName,
  email: null,
  hemaRatingsId: null,
  clubId: null,
  clubLabel: null,
  claimStatus: 'unclaimed',
  globalPersonId: null,
  claimedByUserId: null,
});
const registration = (id: string, personId: string, tournamentId: string, name: string) => ({
  id,
  personId,
  tournamentId,
  tournamentName: name,
  status: 'registered',
  seed: null,
  waitlistPosition: null,
});

const READS: Record<string, unknown> = {
  '/api/v1/events/ev1/persons': [person('p-1', 'Ana', 'Roux'), person('p-2', 'Ben', 'Morel')],
  '/api/v1/events/ev1/registrations': [
    registration('r-1', 'p-1', 't-1', 'Longsword'),
    registration('r-2', 'p-2', 't-2', 'Sabre'),
  ],
  '/api/v1/events/ev1/tournaments': [
    { id: 't-1', name: 'Longsword', color: null },
    { id: 't-2', name: 'Sabre', color: null },
  ],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The label of the pressed Tournament tab, its count left out. */
function pressedTab(): string {
  const pressed = container.querySelector('button[aria-pressed="true"]');
  return pressed?.firstChild?.textContent ?? '';
}

let container: HTMLDivElement;
let root: Root;

async function openRoster(search: string) {
  NAVIGATION.search = new URLSearchParams(search);
  window.history.replaceState(null, '', `/org/org/events/ev1/persons${search ? `?${search}` : ''}`);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PersonsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path in READS) return { ok: true, data: READS[path] };
    throw new Error(`unexpected request ${path}`);
  });
  NAVIGATION.replaced.length = 0;
  // Another page remembered Sabre: the roster must not open on it.
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'myclash.tournament.ev1' ? 't-2' : null),
    setItem: () => undefined,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('the roster’s Tournament tab', () => {
  it('opens on every participant when its address names no Tournament', async () => {
    await openRoster('');
    expect(pressedTab()).toBe('All Participants');
    expect(container.textContent).toContain('ROUX');
    expect(container.textContent).toContain('MOREL');
  });

  it("names a claim and a Registration's state in words, not as raw values (X1)", async () => {
    await openRoster('tournamentId=t-2');
    const chips = [...container.querySelectorAll('td span')].map((span) => span.textContent);
    expect(chips).toContain('Unclaimed');
    expect(chips).toContain('Registered');
    expect(chips).not.toContain('unclaimed');
    expect(chips).not.toContain('registered');
  });

  it('opens on the Tournament its address names, and keeps that address', async () => {
    await openRoster('tournamentId=t-2');
    expect(pressedTab()).toBe('Sabre');
    expect(container.textContent).not.toContain('ROUX');
    expect(container.textContent).toContain('MOREL');
    expect(NAVIGATION.replaced).toEqual([]);
  });

  it('keeps the address of a link when the Tournament list could not be read', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
      if (path === '/api/v1/events/ev1/tournaments') {
        return {
          ok: false as const,
          kind: 'http' as const,
          status: 500,
          detail: null,
          validationErrors: null,
          code: null,
          details: null,
        };
      }
      if (path in READS) return { ok: true, data: READS[path] };
      throw new Error(`unexpected request ${path}`);
    });
    await openRoster('tournamentId=t-2');
    expect(pressedTab()).toBe('All Participants');
    expect(NAVIGATION.replaced).toEqual([]);
  });

  it('keeps the Tournament in the address when the waiting list opens', async () => {
    await openRoster('tournamentId=t-2');
    const waitingList = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Waiting list',
    );
    expect(waitingList, 'no "Waiting list" button').toBeDefined();
    await act(async () => waitingList!.click());
    await settle();
    expect(window.location.search).toBe('?tournamentId=t-2');
    expect(window.location.hash).toBe('#waiting-list');
  });
});
