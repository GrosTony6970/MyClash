import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { SwissAdminView, UseSwissAdmin } from '../useSwissAdmin';
import { ConfigureTab } from './ConfigureTab';

/**
 * "Put back in the pairings" (rulings 108, 121, 122): beside every withdrawn entrant of the Swiss
 * Configure tab, whoever withdrew them. It asks nothing, as the Withdraw beside it; the API refuses
 * a Fighter out of the Tournament (`fighter_out`), in the reader's language.
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
    grouping: { kind: 'points' },
    rankBy: 'swissPts',
    points: { win: 3, draw: 1, loss: 0, bye: 3 },
    tiebreakChain: ['buchholz'],
    finalized: null,
  },
  registeredCount: 2,
  ratingCoverage: null,
  recommendedRoundCount: 5,
  entrants: [
    // A marker: the entrant the organiser puts back, out from round 3.
    { registrationId: 'r-zelie', personName: 'Zélie Marker', clubLabel: null, withdrawnAtRound: 3 },
    {
      registrationId: 'r-paired',
      personName: 'Paul Paired',
      clubLabel: null,
      withdrawnAtRound: null,
    },
  ],
  rounds: [],
};

let container: HTMLDivElement;
let root: Root;
let answer: () => Promise<unknown>;
let reload: ReturnType<typeof vi.fn>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openTab({ locale = 'en' as 'en' | 'fr', isReadOnly = false } = {}) {
  const swiss: UseSwissAdmin = {
    view: VIEW,
    loading: false,
    error: null,
    setError: () => undefined,
    reload: reload as unknown as () => Promise<void>,
    nameOf: () => '',
  };
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ConfigureTab
            tournamentId="t-1"
            swiss={swiss}
            isReadOnly={isReadOnly}
            slug="org"
            eventId="ev1"
          />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

/** The writes the tab sent: path and body. */
const writes = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => (init as { method?: string } | undefined)?.method === 'POST')
    .map(([, path, init]) => [path, (init as { body?: unknown }).body]);

const rowOf = (name: string) =>
  [...container.querySelectorAll('li')].find((row) => row.textContent?.includes(name));
const buttonIn = (scope: ParentNode | undefined, label: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) as
    HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = async () => ({ ok: true, data: { status: 'put_back', missedRounds: [3, 4] } });
  reload = vi.fn(async () => undefined);
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, _path: string, init?: unknown) => {
    if ((init as { method?: string } | undefined)?.method === 'POST')
      return (await answer()) as never;
    // The band preview's standings read.
    return { ok: true, data: { rows: [] } } as never;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('the Swiss Configure tab: Put back in the pairings', () => {
  it('puts a withdrawn entrant back, and reads the phase again', async () => {
    await openTab();
    const row = rowOf('Zélie Marker');
    expect(row?.textContent).toContain('out from round 3');

    await act(async () => buttonIn(row, en.organizer.swiss.configure.reinstate)!.click());
    await settle();

    expect(writes()).toEqual([
      ['/api/v1/swiss-phases/ph-1/reinstate', { registrationId: 'r-zelie' }],
    ]);
    expect(reload).toHaveBeenCalled();
    expect(document.body.textContent).toContain(en.organizer.swiss.configure.reinstated);
  });

  it('offers Withdraw, never Put back, beside an entrant still paired', async () => {
    await openTab();
    const row = rowOf('Paul Paired');
    expect(buttonIn(row, en.organizer.swiss.configure.withdraw)).toBeDefined();
    expect(buttonIn(row, en.organizer.swiss.configure.reinstate)).toBeUndefined();
  });

  it('is locked on a read-only screen: nothing is sent', async () => {
    await openTab({ isReadOnly: true });
    const button = buttonIn(rowOf('Zélie Marker'), en.organizer.swiss.configure.reinstate)!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    await settle();
    expect(writes()).toEqual([]);
  });

  it('is locked while its press is being saved', async () => {
    let finish: (value: unknown) => void = () => undefined;
    answer = () => new Promise((resolve) => (finish = resolve));
    await openTab();
    const button = () => buttonIn(rowOf('Zélie Marker'), en.organizer.swiss.configure.reinstate)!;

    await act(async () => button().click());
    expect(button().disabled).toBe(true);
    await act(async () => button().click());
    expect(writes()).toHaveLength(1);

    await act(async () => finish({ ok: true, data: { status: 'put_back', missedRounds: [] } }));
    await settle();
    expect(button().disabled).toBe(false);
  });

  it('says a Fighter out of the tournament is refused, in French', async () => {
    answer = async () => ({
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'This fighter is out of the tournament: bring them back first',
      code: 'fighter_out',
      details: null,
      validationErrors: null,
    });
    await openTab({ locale: 'fr' });

    await act(async () =>
      buttonIn(rowOf('Zélie Marker'), fr.organizer.swiss.configure.reinstate)!.click(),
    );
    await settle();

    expect(document.body.textContent).toContain(fr.organizer.swiss.configure.fighterOut);
    expect(document.body.textContent).not.toContain('bring them back first');
    expect(reload).not.toHaveBeenCalled();
  });
});
