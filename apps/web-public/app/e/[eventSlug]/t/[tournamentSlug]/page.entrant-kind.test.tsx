// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { createTranslator, getMessages } from '@myclash/i18n';
import TournamentPage, { generateMetadata } from './page';
import { PoolMatchesView } from './PoolMatchesView';
import { PoolsCompositionView } from './PoolsCompositionView';
import { StandingsView } from './StandingsView';
import { BracketLive } from './BracketLive';
import { TournamentTabs } from './TournamentTabs';

/**
 * The Tournament page names its entrants by the Tournament's own kind (`entrantKind`, read by the
 * API), never by guessing from the Pools' seats: a team Tournament whose only Pool seats nobody
 * yet still counts teams. The page's title and description are where the count is said even at
 * zero, and the page hands the kind to every tab that names entrants.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('../../../../../src/lib/api-url', () => ({
  getServerApiUrl: () => 'http://api.test',
  getPublicApiUrl: () => 'http://api.test',
}));
vi.mock('../../../../../src/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));
vi.mock('../../../../../src/lib/login-cookie', () => ({ requestLoginHeader: async () => ({}) }));
vi.mock('@myclash/next-i18n/server', () => ({
  getServerT: async () => createTranslator(getMessages('en')),
  resolveServerLocale: async () => 'en',
}));
vi.mock('../../_lib/event-or-not-found', () => ({
  readEventOnce: async () => ({ kind: 'notFound' }),
}));

/**
 * The standings read of a Tournament of `kind` whose one Pool seats nobody yet. The page's other
 * reads (its participants, its recap) find nothing.
 */
function serve(kind: 'individual' | 'team') {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) =>
    path.endsWith('/standings')
      ? standingsOf(kind)
      : ({ ok: false, kind: 'http', status: 404 } as never),
  );
}

function standingsOf(kind: 'individual' | 'team') {
  return {
    ok: true,
    data: {
      tournament: {
        id: 't1',
        name: 'Longsword Open',
        weapon: 'longsword',
        rulesetCode: 'TF_v1',
        rulesetLabel: 'TF v1',
        status: 'running',
        rulesetRepins: [],
        entrantKind: kind,
      },
      pools: [{ id: 'p1', name: 'Pool A', members: [], referees: [], standings: [] }],
      // One bout to come, so the bracket tab draws its bracket.
      bracketSlots: [{ id: 's1', round: 1, position: 1, status: 'scheduled', referees: [] }],
      bracketSize: 0,
      bracketRounds: 0,
    },
  } as never;
}

const params = { params: Promise.resolve({ eventSlug: 'open', tournamentSlug: 'longsword-open' }) };
const metadataOf = () => generateMetadata(params as never);

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

/** The `teams` the page hands to the component of `type` in the tab `key`. */
async function teamsOfTab(key: string, type: unknown) {
  const tabs = find(await TournamentPage(params as never), TournamentTabs)!.props['tabs'] as Array<{
    key: string;
    panel: ReactNode;
  }>;
  return find(tabs.find((tab) => tab.key === key)!.panel, type)!.props['teams'];
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});

describe("the Tournament page's count of entrants", () => {
  it('a team Tournament with an empty Pool counts teams', async () => {
    serve('team');
    expect((await metadataOf()).description).toBe('0 teams · TF v1');
  });

  it('an individual Tournament with an empty Pool counts fighters', async () => {
    serve('individual');
    expect((await metadataOf()).description).toBe('0 fighters · TF v1');
  });
});

describe("the Tournament page's tabs are told the Tournament's kind", () => {
  const TABS = [
    ['pools', PoolsCompositionView],
    ['poolmatches', PoolMatchesView],
    ['standings', StandingsView],
    ['bracket', BracketLive],
  ] as const;

  for (const [key, type] of TABS) {
    it(`the ${key} tab of a team Tournament with an empty Pool names teams`, async () => {
      serve('team');
      expect(await teamsOfTab(key, type)).toBe(true);
    });

    it(`the ${key} tab of an individual Tournament names Fighters`, async () => {
      serve('individual');
      expect(await teamsOfTab(key, type)).toBe(false);
    });
  }
});
