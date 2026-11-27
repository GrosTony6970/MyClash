import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ApproveModal } from '../../../app/admin/review-queue/_components/ApproveModal';
import type { ReviewQueueItem } from '../../../app/admin/review-queue/_types';
import { LeagueRequestsPanel } from './LeagueRequestsPanel';

/**
 * The two screens that approve a League link: the League's requests panel (on its edit page) and
 * the platform review queue. Lyon asked the French League to take "Longsword Open", which was
 * rejected; Lyon then switched it to a team Tournament, and the request was approved again. The
 * API refuses (409 `team_tournament_league`, rulings 729, 981), and each screen says why in the
 * reader's language instead of the API's English sentence.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('../../lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const TEAM_LEAGUE = {
  ok: false,
  kind: 'http',
  status: 409,
  detail: 'An English sentence from the API.',
  code: 'CONFLICT',
  details: { reason: 'team_tournament_league' },
  validationErrors: null,
};
const REQUEST = {
  id: 'link-1',
  status: 'requested',
  created_at: '2026-11-20T10:00:00.000Z',
  reviewed_at: null,
  tournaments: { id: 't-long', name: 'Longsword Open', weapon: null, events: null },
};

const sent: string[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent.length = 0;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method) {
      sent.push(`${init.method} ${path}`);
      return TEAM_LEAGUE as never;
    }
    if (path === '/api/v1/admin/leagues/lg-fr/requests?status=requested') {
      return { ok: true, data: [REQUEST] } as never;
    }
    if (path === '/api/v1/admin/leagues/lg-fr/membership-requests?status=requested') {
      return { ok: true, data: [] } as never;
    }
    throw new Error(`unexpected request ${path}`);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(locale: 'en' | 'fr', screen: ReactElement) {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>{screen}</ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

async function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await settle();
}

describe('an approval of a League link to a team Tournament', () => {
  it('the League requests panel says League points belong to persons', async () => {
    await render('fr', <LeagueRequestsPanel leagueId="lg-fr" />);
    await press('Accepter');

    expect(sent).toEqual(['PATCH /api/v1/admin/league-tournament-links/link-1']);
    expect(document.body.textContent).toContain('Les points de ligue appartiennent aux personnes.');
    expect(document.body.textContent).not.toContain('An English sentence from the API.');
  });

  it('the review queue says League points belong to persons', async () => {
    const item = {
      type: 'league_tournament_request',
      id: 'link-1',
      status: 'pending',
      targetLabel: 'Longsword Open → French League',
    } as ReviewQueueItem;
    const onApproved = vi.fn();
    await render(
      'en',
      <ApproveModal
        item={item}
        apiUrl="http://api.test"
        onClose={() => undefined}
        onApproved={onApproved}
      />,
    );
    await press('Approve');

    expect(sent).toEqual([
      'POST /api/v1/admin/review-queue/league_tournament_request/link-1/approve',
    ]);
    expect(document.body.textContent).toContain('League points belong to persons.');
    expect(onApproved).not.toHaveBeenCalled();
  });
});
