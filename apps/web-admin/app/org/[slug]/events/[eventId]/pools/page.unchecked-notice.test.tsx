import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';
import type { PoolMemberSeat } from './pool-seats';

/**
 * The rule-8 notice of the Pools page (CLAUDE.md rule 8; ADR-016, 2026-11-13). The page assigns
 * referees on two tabs: Referees (per Pool) and Matches (per bout). A team's slots have no names
 * in slice 1b-1, so neither can be checked against the team's Fighters. The page says so once,
 * above the tabs, for a Tournament whose Pools seat teams, and says nothing for Pools of Fighters.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => <p data-tab="matches" /> }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => <p data-tab="referees" /> }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const NOTICE = 'MyClash cannot check these Fighters: this team has Fighters with no name';

const seat = (kind: 'team' | 'individual', id: string, name: string): PoolMemberSeat => ({
  sideId: id,
  kind,
  registrationId: kind === 'team' ? null : id,
  name,
  personName: kind === 'team' ? null : name,
  clubLabel: null,
  colour: kind === 'team' ? 'red' : null,
  logoUrl: null,
  hemaWeightedRating: null,
  seed: 1,
});

/** How a Tournament's `/pools` read answers: its Pools, a refusal, or not yet. */
type PoolsRead = 'ok' | 'failed' | 'pending';

const FAILED = {
  ok: false,
  kind: 'http',
  status: 500,
  detail: 'down',
  code: null,
  details: null,
  validationErrors: null,
};

/**
 * Serves t1 (Longsword, of `kind`) and, when `second` is given, t2 of that kind. Each
 * Tournament's Pools seat entrants of its own kind; `reads` says how each `/pools` read answers.
 */
function serve(
  kind: 'team' | 'individual',
  {
    second,
    reads = {},
  }: { second?: 'team' | 'individual'; reads?: Record<string, PoolsRead> } = {},
) {
  const kinds: Record<string, 'team' | 'individual'> = {
    t1: kind,
    ...(second ? { t2: second } : {}),
  };
  const membersOf = (k: 'team' | 'individual') =>
    k === 'team'
      ? [seat('team', 'team-lyon', 'Lyon Blades'), seat('team', 'team-paris', 'Paris Rapiers')]
      : [seat('individual', 'reg-anna', 'Anna Roux'), seat('individual', 'reg-ben', 'Ben Morel')];
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === '/api/v1/events/ev1/tournaments') {
      return {
        ok: true,
        data: Object.entries(kinds).map(([id, k]) => ({ id, name: id, entrant_kind: k })),
      };
    }
    const [, tournament, what] = /^\/api\/v1\/tournaments\/(t\d)\/(.+)$/.exec(path) ?? [];
    if (tournament && kinds[tournament]) {
      if (what === 'pools') {
        const read = reads[tournament] ?? 'ok';
        if (read === 'pending') return new Promise(() => undefined) as never;
        if (read === 'failed') return FAILED as never;
        return {
          ok: true,
          data: {
            phaseId: `ph-${tournament}`,
            pools: [{ id: 'p1', name: 'Pool A', members: membersOf(kinds[tournament]!) }],
          },
        };
      }
      if (what === 'unassigned-fighters') return { ok: true, data: [] };
      if (what === 'conflict-check') return { ok: true, data: { conflicts: [] } };
    }
    throw new Error(`unexpected request ${path}`);
  });
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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.location.hash = '';
});

async function render() {
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

async function openOn(tab: 'matches' | 'referees') {
  window.location.hash = `#${tab}`;
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
  // The tab really is open: the notice is not a Configure-only banner.
  expect(container.querySelector(`[data-tab="${tab}"]`)).not.toBeNull();
}

const note = () => container.querySelector('[role="note"]');

describe('Pools page: the rule-8 notice', () => {
  for (const tab of ['referees', 'matches'] as const) {
    it(`shows on the ${tab} tab of a team Pool`, async () => {
      serve('team');
      await openOn(tab);
      expect(note()?.textContent).toBe(NOTICE);
    });

    it(`does not show on the ${tab} tab of a Pool of Fighters`, async () => {
      serve('individual');
      await openOn(tab);
      expect(note()).toBeNull();
    });
  }

  // Review, fix round 1: the note read the loaded Pools, which are null while they load and stay
  // null when their read fails, while the Referees tab still staffs the team Pool.
  for (const read of ['failed', 'pending'] as const) {
    it(`shows on the referees tab of a team Tournament whose Pools read is ${read}`, async () => {
      serve('team', { reads: { t1: read } });
      await openOn('referees');
      expect(note()?.textContent).toBe(NOTICE);
    });
  }
});

describe('Pools page: a switch of Tournament', () => {
  async function switchTo(name: string) {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === name,
    );
    await act(async () => button!.click());
    await settle();
  }

  it('drops the team note and the teams the moment an individual Tournament is picked', async () => {
    serve('team', { second: 'individual', reads: { t2: 'pending' } });
    await render();
    expect(note()?.textContent).toBe(NOTICE);
    expect(container.textContent).toContain('Lyon Blades');

    await switchTo('t2');
    // t2's Pools have not answered: nothing of t1's may stand in for them.
    expect(note()).toBeNull();
    expect(container.textContent).not.toContain('Lyon Blades');
  });
});
