import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';

/**
 * O7 (ruled 2026-10-14): the Pools page shows the Tournament its address names, then the
 * one last picked in this Event on this browser, then the first. Before, a refresh and
 * every dashboard link opened the first Tournament: the organiser running the fourth one
 * landed on the first.
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
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => null }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const TOURNAMENTS = [
  { id: 't1', name: 'Longsword' },
  { id: 't2', name: 'Sabre' },
  { id: 't3', name: 'Rapier' },
];
const POOLS_READ = /^\/api\/v1\/tournaments\/([^/]+)\/pools$/;

function serve() {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === '/api/v1/events/ev1/tournaments') return { ok: true, data: TOURNAMENTS };
    if (POOLS_READ.test(path)) return { ok: true, data: { phaseId: null, pools: [] } };
    if (path.endsWith('/unassigned-fighters')) return { ok: true, data: [] };
    if (path.endsWith('/conflict-check')) return { ok: true, data: { conflicts: [] } };
    throw new Error(`unexpected request ${path}`);
  });
}

/** The Tournaments whose pools were read, in order. */
function poolsRead(): string[] {
  return vi
    .mocked(apiRequest)
    .mock.calls.map(([, path]) => POOLS_READ.exec(path)?.[1])
    .filter((id): id is string => id !== undefined);
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;
let kept: Map<string, string>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  serve();
  NAVIGATION.search = new URLSearchParams();
  NAVIGATION.replaced.length = 0;
  // This test run has no `localStorage`: one kept in a map, as a browser keeps it.
  kept = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  });
  window.history.replaceState(null, '', '/org/org/events/ev1/pools#matches');
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

async function openPage() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <PoolsPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

describe('the Pools page keeps its Tournament (O7)', () => {
  it('opens on the Tournament last picked in this Event, and puts it in the address', async () => {
    kept.set('myclash.tournament.ev1', 't2');
    await openPage();
    expect(poolsRead()).toEqual(['t2']);
    expect(NAVIGATION.replaced).toEqual(['/org/org/events/ev1/pools?tournamentId=t2#matches']);
  });

  it('opens on the Tournament a link names, over the one last picked', async () => {
    kept.set('myclash.tournament.ev1', 't2');
    NAVIGATION.search = new URLSearchParams('tournamentId=t3');
    await openPage();
    expect(poolsRead()).toEqual(['t3']);
    expect(kept.get('myclash.tournament.ev1')).toBe('t3');
  });

  it('opens on the one last picked when the link names a Tournament the Event does not hold', async () => {
    kept.set('myclash.tournament.ev1', 't2');
    NAVIGATION.search = new URLSearchParams('tournamentId=elsewhere');
    await openPage();
    expect(poolsRead()).toEqual(['t2']);
  });

  it('remembers a Tournament picked on the page, and its link to the bracket carries it', async () => {
    await openPage();
    const sabre = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Sabre',
    );
    await act(async () => sabre!.click());
    await settle();
    expect(poolsRead()).toEqual(['t1', 't2']);
    expect(kept.get('myclash.tournament.ev1')).toBe('t2');
    expect(NAVIGATION.replaced.at(-1)).toBe('/org/org/events/ev1/pools?tournamentId=t2#matches');
    const toBracket = [...container.querySelectorAll('a')].find((a) =>
      a.getAttribute('href')?.includes('/bracket'),
    );
    expect(toBracket?.getAttribute('href')).toBe('/org/org/events/ev1/bracket?tournamentId=t2');
  });
});
