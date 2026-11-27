import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import EditLeaguePage from './page';

/**
 * The League edit page's Tournament picker: a League takes individual Tournaments only (rulings
 * 729, 981). Lyon's Spring Cup holds "Team Longsword" (a team Tournament) and "Longsword Open". The
 * picker marks the team Tournament and does not offer it; a link the API refuses says why.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'lg-fr' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('./LeagueFreshnessBadge', () => ({ LeagueFreshnessBadge: () => null }));
vi.mock('./RecomputePreflight', () => ({ RecomputePreflight: () => null }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const LEAGUE = {
  id: 'lg-fr',
  slug: 'french-league',
  name: 'French League',
  description: null,
  season_year: 2026,
  status: 'draft',
  public_visibility: false,
  logo_url: null,
  scoring_system: 'ffamhe_tf_2026',
  scoring_config: null,
};
const READS: Record<string, unknown> = {
  '/api/v1/admin/leagues': [LEAGUE],
  '/api/v1/events?status=all': [{ id: 'ev1', name: 'Spring Cup', slug: 'spring-cup' }],
  '/api/v1/events/ev1/tournaments': [
    { id: 't-team', name: 'Team Longsword', weapon: null, status: 'draft', entrant_kind: 'team' },
    {
      id: 't-long',
      name: 'Longsword Open',
      weapon: null,
      status: 'draft',
      entrant_kind: 'individual',
    },
  ],
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
    // Every other read of the page (roles, links, groups, scoring systems) is empty.
    return { ok: true, data: path in READS ? READS[path] : [] } as never;
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

async function press(label: string, within: ParentNode = container) {
  const button = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await settle();
}

const rowOf = (name: string) =>
  [...container.querySelectorAll('li')].find((li) => li.textContent?.startsWith(name))!;

async function openPicker() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <EditLeaguePage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
  await press('Spring Cup+');
}

describe('a team Tournament in the League edit picker', () => {
  it('is marked and not offered', async () => {
    await openPicker();

    expect(rowOf('Team Longsword').textContent).toContain('League points belong to persons.');
    expect(rowOf('Team Longsword').querySelector('button')).toBeNull();
    expect(rowOf('Longsword Open').querySelector('button')).not.toBeNull();
  });

  it('a link the API refuses says League points belong to persons', async () => {
    await openPicker();
    await act(async () => rowOf('Longsword Open').querySelector('button')!.click());
    await settle();

    expect(sent).toEqual(['POST /api/v1/admin/leagues/lg-fr/tournaments/t-long/link']);
    // The page's error banner, not the team row's mark (which says the same words).
    const banner = [...container.querySelectorAll('div')].find(
      (d) => d.textContent === 'League points belong to persons.',
    );
    expect(banner).toBeDefined();
    expect(container.textContent).not.toContain('An English sentence from the API.');
  });
});
