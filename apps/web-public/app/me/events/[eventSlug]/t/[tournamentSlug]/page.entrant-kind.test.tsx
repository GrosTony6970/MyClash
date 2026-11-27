// @vitest-environment jsdom
import { act, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../../src/i18n/I18nProvider';
import { PoolMatchesView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/PoolMatchesView';
import { PoolsCompositionView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/PoolsCompositionView';
import { StandingsView } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/StandingsView';
import { BracketLive } from '../../../../../e/[eventSlug]/t/[tournamentSlug]/BracketLive';
import PersonalTournamentPage from './page';

/**
 * The personal space's Tournament page hands the Tournament's own kind (`entrantKind`) to every
 * tab that names entrants: a team Tournament whose only Pool seats nobody yet still names teams.
 * The tabs themselves are drawn by `team-pools.test.tsx`; here the page's wiring is read.
 */
const captured = vi.hoisted(() => ({
  tabs: null as Array<{ key: string; panel: ReactNode }> | null,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ eventSlug: 'open', tournamentSlug: 'longsword-open' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../../../../../src/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('../../../../../../src/lib/supabase-browser', () => ({
  useRealtimeWithFallback: () => {},
}));
vi.mock('../../../../../../src/components/me/hooks', () => ({
  useMyEvents: () => ({ events: [], loading: false, error: false, retry: () => {} }),
}));
vi.mock('../../../../../e/[eventSlug]/t/[tournamentSlug]/TournamentTabs', () => ({
  TournamentTabs: (props: { tabs: Array<{ key: string; panel: ReactNode }> }) => {
    captured.tabs = props.tabs;
    return null;
  },
}));

/** The standings read of a Tournament of `kind` whose one Pool seats nobody yet. */
const standingsOf = (kind: 'individual' | 'team') => ({
  tournament: {
    id: 't1',
    name: 'Longsword Open',
    weapon: 'longsword',
    rulesetCode: 'TF_v1',
    status: 'running',
    rulesetRepins: [],
    entrantKind: kind,
  },
  pools: [{ id: 'p1', name: 'Pool A', members: [], referees: [], standings: [] }],
  // One bout to come, so the bracket tab draws its bracket.
  bracketSlots: [{ id: 's1', round: 1, position: 1, status: 'scheduled', referees: [] }],
  bracketSize: 0,
  bracketRounds: 0,
});

/** The first element of `type` in a drawn tree, looked for through every element's children. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  return find(node.props.children, type);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  captured.tabs = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** The `teams` the page hands to the component of `type` in the tab `key`. */
async function teamsOfTab(kind: 'individual' | 'team', key: string, type: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(standingsOf(kind)) })),
  );
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <PersonalTournamentPage />
      </I18nProvider>,
    );
  });
  await act(async () => {});
  expect(captured.tabs, 'the page drew no tabs').not.toBeNull();
  return find(captured.tabs!.find((tab) => tab.key === key)!.panel, type)!.props['teams'];
}

describe("the personal space's Tournament tabs are told the Tournament's kind", () => {
  const TABS = [
    ['pools', PoolsCompositionView],
    ['poolmatches', PoolMatchesView],
    ['standings', StandingsView],
    ['bracket', BracketLive],
  ] as const;

  for (const [key, type] of TABS) {
    it(`the ${key} tab of a team Tournament with an empty Pool names teams`, async () => {
      expect(await teamsOfTab('team', key, type)).toBe(true);
    });

    it(`the ${key} tab of an individual Tournament names Fighters`, async () => {
      expect(await teamsOfTab('individual', key, type)).toBe(false);
    });
  }
});
