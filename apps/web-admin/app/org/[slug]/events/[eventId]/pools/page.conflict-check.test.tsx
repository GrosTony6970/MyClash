import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import PoolsPage from './page';

/**
 * When the Pools page runs the fighter/referee conflict check.
 *
 * It used to run only after an edit on this page. A referee set on a Match or a
 * bout moved on the grid makes a clash without one, and a Tournament that was
 * never checked shows the same nothing as a clean one (hard rule 8). So the check
 * runs whenever a Tournament's pools load: on opening the page and on every
 * choice of a Tournament, including one already checked.
 *
 * The page is MOUNTED, not rendered to markup: the check starts in an effect,
 * and static rendering runs no effects.
 */

vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'org', eventId: 'ev1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
// The tabs render only on their own hash; stubbed so their imports stay out of this test.
vi.mock('./_tabs/MatchesTab', () => ({ MatchesTab: () => null }));
vi.mock('./_tabs/StandingsTab', () => ({ StandingsTab: () => null }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const CLASH = {
  conflicts: [
    {
      personName: 'Ada Lovelace',
      fightingMatchLabel: 'L1-P1-M01',
      refereeingMatchLabel: 'L2-P2-M03',
      confirmed: true,
    },
  ],
  hasConfirmedConflicts: true,
  hasPotentialConflicts: false,
};
const CLEAN = { conflicts: [], hasConfirmedConflicts: false, hasPotentialConflicts: false };

const TOURNAMENT_PATH =
  /^\/api\/v1\/tournaments\/([^/]+)\/(pools|unassigned-fighters|conflict-check)$/;

/**
 * Answers the page's reads. A request nobody expected throws, and the unhandled
 * rejection fails the run.
 */
function serve(tournaments: Array<{ id: string; name: string }>, clashes: Record<string, unknown>) {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === '/api/v1/events/ev1/tournaments') return { ok: true, data: tournaments };
    if (path === '/api/v1/events/ev1') return { ok: true, data: { status: 'draft' } };
    const [, tournamentId = '', read] = TOURNAMENT_PATH.exec(path) ?? [];
    if (read === 'pools') return { ok: true, data: { phaseId: null, pools: [] } };
    if (read === 'unassigned-fighters') return { ok: true, data: [] };
    if (read === 'conflict-check') return { ok: true, data: clashes[tournamentId] ?? CLEAN };
    throw new Error(`unexpected request ${path}`);
  });
}

function checkedTournaments(): string[] {
  return vi
    .mocked(apiRequest)
    .mock.calls.map(([, path]) => TOURNAMENT_PATH.exec(path))
    .filter((match) => match?.[2] === 'conflict-check')
    .map((match) => match![1]!);
}

/** Lets every pending fetch, timer and state update land. */
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
});

async function choose(tournamentName: string) {
  const chip = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === tournamentName,
  );
  expect(chip, `no Tournament chip named ${tournamentName}`).toBeDefined();
  await act(async () => chip!.click());
  await settle();
}

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

describe('Pools page conflict check', () => {
  it('opening the page shows a clash on the first Tournament without any edit', async () => {
    serve([{ id: 't1', name: 'Longsword' }], { t1: CLASH });

    await openPage();

    expect(checkedTournaments()).toContain('t1');
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('L2-P2-M03');
  });

  it('choosing another Tournament checks that Tournament and shows its clash', async () => {
    serve(
      [
        { id: 't1', name: 'Longsword' },
        { id: 't2', name: 'Sabre' },
      ],
      { t2: CLASH },
    );
    await openPage();
    expect(checkedTournaments()).toEqual(['t1']);
    expect(container.textContent).not.toContain('Ada Lovelace');

    await choose('Sabre');

    expect(checkedTournaments()).toEqual(['t1', 't2']);
    expect(container.textContent).toContain('Ada Lovelace');
  });

  it('coming back to a Tournament checks it again and shows a clash made since', async () => {
    // The answer already kept for Longsword is clean. A page that trusted it, and
    // checked each Tournament once, would never show the clash made afterwards.
    const clashes: Record<string, unknown> = {};
    serve(
      [
        { id: 't1', name: 'Longsword' },
        { id: 't2', name: 'Sabre' },
      ],
      clashes,
    );
    await openPage();
    expect(container.textContent).not.toContain('Ada Lovelace');

    clashes['t1'] = CLASH;
    await choose('Sabre');
    await choose('Longsword');

    expect(checkedTournaments()).toEqual(['t1', 't2', 't1']);
    expect(container.textContent).toContain('Ada Lovelace');
  });
});
