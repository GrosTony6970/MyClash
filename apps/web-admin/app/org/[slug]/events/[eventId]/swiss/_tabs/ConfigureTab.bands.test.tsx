import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { SwissStandingsWireRow } from '@myclash/types/pool-standings';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { SwissAdminView, UseSwissAdmin } from '../useSwissAdmin';
import { ConfigureTab } from './ConfigureTab';

/**
 * The band preview reads the Swiss standings answer, and each row names its entrant by `entrantId`.
 * A reader of the old `registrationId` gets `undefined` for every row, and every band then shows
 * the last Fighter's name.
 */

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

const VIEW: SwissAdminView = {
  phaseId: 'ph-1',
  config: {
    roundCount: 5,
    seedingStrategy: 'random',
    pairingMethod: 'fold',
    grouping: { kind: 'scoreBands', boundaries: [1] },
    rankBy: 'swissPts',
    points: { win: 3, draw: 1, loss: 0, bye: 3 },
    tiebreakChain: ['buchholz'],
    finalized: null,
  },
  registeredCount: 2,
  ratingCoverage: null,
  recommendedRoundCount: 5,
  entrants: [],
  rounds: [],
};

const row = (entrantId: string, displayName: string, rank: number, score: number) =>
  ({
    rank,
    entrantId,
    displayName,
    club: null,
    status: 'in_progress',
    stats: { score },
    withdrawn: false,
    withdrawnAtRound: null,
  }) satisfies SwissStandingsWireRow;

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
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockResolvedValue({
    ok: true,
    data: { rows: [row('r-alice', 'Alice Ardent', 1, 2), row('r-bob', 'Bob Brisk', 2, 0)] },
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the Swiss Configure tab: the band preview', () => {
  it('names each Fighter in the band their score puts them in', async () => {
    const swiss: UseSwissAdmin = {
      view: VIEW,
      loading: false,
      error: null,
      setError: () => undefined,
      reload: (async () => undefined) as () => Promise<void>,
      nameOf: () => '',
    };
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <ToastProvider>
            <ConfigureTab
              tournamentId="t-1"
              swiss={swiss}
              isReadOnly={false}
              slug="org"
              eventId="ev1"
            />
          </ToastProvider>
        </I18nProvider>,
      );
    });
    await settle();

    const bands = [...container.querySelectorAll('li')].filter((li) =>
      li.textContent?.includes('Band'),
    );
    expect(bands.map((band) => band.textContent)).toEqual([
      expect.stringContaining('Alice Ardent'),
      expect.stringContaining('Bob Brisk'),
    ]);
    expect(bands[0]?.textContent).not.toContain('Bob Brisk');
    expect(bands[1]?.textContent).not.toContain('Alice Ardent');
  });
});
