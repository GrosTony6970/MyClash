import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AttachToLeaguePanel } from './AttachToLeaguePanel';

/**
 * A League takes individual Tournaments only: League points belong to persons (rulings 729, 981).
 * Lyon's Spring Cup holds "Team Longsword" (a team Tournament) and "Longsword Open". The panel marks
 * the team Tournament and does not offer it; a request the API refuses says why, in the reader's
 * language.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const READS: Record<string, unknown> = {
  '/api/v1/leagues/attachable': [{ id: 'lg-fr', name: 'French League' }],
  '/api/v1/events/ev1/tournaments': [
    { id: 't-team', name: 'Team Longsword', entrant_kind: 'team' },
    { id: 't-long', name: 'Longsword Open', entrant_kind: 'individual' },
  ],
  '/api/v1/events/ev1/league-attachments': [],
  '/api/v1/leagues/lg-fr/groups': [],
};
const TEAM_LEAGUE = {
  ok: false,
  kind: 'http',
  status: 409,
  detail: 'An English sentence from the API.',
  code: 'CONFLICT',
  details: { reason: 'team_tournament_league' },
  validationErrors: null,
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
    if (path in READS) return { ok: true, data: READS[path] } as never;
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

async function press(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await settle();
}

async function open(locale: 'en' | 'fr' = 'en') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ToastProvider>
          <AttachToLeaguePanel eventId="ev1" />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

const picker = () => container.querySelector<HTMLSelectElement>('#attach-tournament')!;
const option = (id: string) => picker().querySelector<HTMLOptionElement>(`option[value="${id}"]`)!;

describe('a team Tournament in the League request panel', () => {
  it('is marked and not offered; the individual one is picked', async () => {
    await open();
    await press('Request league attachment');

    expect(option('t-team').disabled).toBe(true);
    expect(option('t-team').textContent).toBe('Team Longsword — League points belong to persons.');
    expect(option('t-long').disabled).toBe(false);
    expect(picker().value).toBe('t-long');
  });

  it('a request the API refuses says League points belong to persons, in French too', async () => {
    await open('fr');
    await press('Demander le rattachement à une ligue');
    await press('Envoyer la demande');

    expect(sent).toEqual(['POST /api/v1/admin/leagues/lg-fr/tournaments/t-long/request']);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Les points de ligue appartiennent aux personnes.',
    );
  });
});
