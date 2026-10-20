import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import type * as Ui from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import BracketPage from './page';

/**
 * The bracket board draws the Tournament's own side colours. The page read `scoring_config`, a
 * key the Tournament row does not hold (it is `scoring_config_json`), so every board drew red and
 * blue whatever the organiser chose — the Locks tab's wrong-key twin.
 */
const drawn = vi.hoisted(() => ({ colors: [] as Array<[string, string]> }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams('tournamentId=t1'),
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
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('./_tabs/RefereesTab', () => ({ RefereesTab: () => null }));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  BracketView: (props: { redColor: string; blueColor: string }) => {
    drawn.colors.push([props.redColor, props.blueColor]);
    return null;
  },
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const BRACKET = {
  phaseId: 'ph1',
  phaseType: 'single_elim',
  bracketSize: 2,
  fighterCount: 2,
  byeCount: 0,
  rounds: 1,
  grandFinalReset: false,
  secondChanceTarget: 'gold',
  bronzeMatch: false,
  repechageEntrySize: null,
  totalSlots: 1,
  slots: [
    {
      id: 's1',
      round: 1,
      position: 1,
      redFighterName: 'Ada',
      blueFighterName: 'Grace',
      redScore: null,
      blueScore: null,
      status: 'pending',
      matchId: null,
    },
  ],
};

function serve(row: Record<string, unknown>) {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    const answers: Record<string, unknown> = {
      '/api/v1/events/ev1/tournaments': [{ id: 't1', name: 'Longsword' }],
      '/api/v1/tournaments/t1': row,
      '/api/v1/tournaments/t1/bracket': BRACKET,
      '/api/v1/tournaments/t1/registrations': [],
      '/api/v1/events/ev1/lices': [],
      '/api/v1/events/ev1/referee-skills': [],
      '/api/v1/events/ev1/referee-assignment-board': null,
    };
    if (!(path in answers)) throw new Error(`unexpected request ${path}`);
    return { ok: true, data: answers[path] } as never;
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  drawn.colors = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openBoard(row: Record<string, unknown>) {
  serve(row);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <BracketPage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the bracket board', () => {
  it("draws the Tournament's own side colours", async () => {
    await openBoard({
      weapon: 'longsword',
      scoring_config_json: { display: { sideColors: { red: 'black', blue: 'white' } } },
    });
    expect(drawn.colors.at(-1)).toEqual(['black', 'white']);
  });

  it('draws red and blue for a Tournament that chose none', async () => {
    await openBoard({ weapon: 'longsword', scoring_config_json: null });
    expect(drawn.colors.at(-1)).toEqual(['red', 'blue']);
  });
});
