import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { LeagueAttachmentsSection } from './LeagueAttachmentsSection';

/**
 * The org Leagues hub's attach section: a League takes individual Tournaments only (rulings 729,
 * 981). Lyon holds "Team Longsword" (a team Tournament) and "Longsword Open". The picker marks the
 * team Tournament and does not offer it; a request the API refuses says why.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const READS: Record<string, unknown> = {
  '/api/v1/organizations/org-lyon/tournaments': [
    {
      id: 't-team',
      name: 'Team Longsword',
      weapon: null,
      entrant_kind: 'team',
      event_id: 'ev1',
      event_name: 'Spring Cup',
    },
    {
      id: 't-long',
      name: 'Longsword Open',
      weapon: null,
      entrant_kind: 'individual',
      event_id: 'ev1',
      event_name: 'Spring Cup',
    },
  ],
  '/api/v1/leagues/lg-fr/groups': [],
  '/api/v1/organizations/org-lyon/league-attachments?leagueId=lg-fr': [],
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
      return {
        ok: false,
        kind: 'http',
        status: 409,
        detail: 'An English sentence from the API.',
        code: 'CONFLICT',
        details: { reason: 'team_tournament_league' },
        validationErrors: null,
      } as never;
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
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await settle();
}

async function open() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <LeagueAttachmentsSection orgId="org-lyon" leagueId="lg-fr" />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
  await press('Show attached tournaments');
}

const option = (id: string) =>
  container.querySelector<HTMLOptionElement>(`select option[value="${id}"]`)!;

describe('a team Tournament in the org Leagues hub', () => {
  it('is marked and not offered; the individual one is picked', async () => {
    await open();

    expect(option('t-team').disabled).toBe(true);
    expect(option('t-team').textContent).toBe('Team Longsword — League points belong to persons.');
    expect(option('t-long').disabled).toBe(false);
    expect(container.querySelector('select')!.value).toBe('t-long');
  });

  it('a request the API refuses says League points belong to persons', async () => {
    await open();
    await press('Attach');

    expect(sent).toEqual(['POST /api/v1/admin/leagues/lg-fr/tournaments/t-long/request']);
    // The section's message line, not the team option's mark (which says the same words).
    const line = [...container.querySelectorAll('p')].find(
      (p) => p.textContent === 'League points belong to persons.',
    );
    expect(line).toBeDefined();
    expect(container.textContent).not.toContain('An English sentence from the API.');
  });
});
