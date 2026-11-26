import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import NewLeaguePage from './page';

/**
 * A League takes individual Tournaments only: League points belong to persons (rulings 729, 981).
 * The operator creates the French League and picks Tournaments of Lyon's Spring Cup: "Team
 * Longsword" (a team Tournament) is marked and not offered. "Longsword Open" is picked, but it was
 * switched to team before the create: its link is refused, and the page says so before it leaves
 * for the League's edit page (an error toast stays until clicked).
 */
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
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

const READS: Record<string, unknown> = {
  '/api/v1/admin/organizations?perPage=200&excludePlatform=true': [],
  '/api/v1/events?status=all': [
    { id: 'ev1', name: 'Spring Cup', slug: 'spring-cup', start_date: null },
  ],
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
const LINK = 'POST /api/v1/admin/leagues/lg-new/tournaments/t-long/link';
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
  push.mockReset();
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (init?.method) {
      sent.push(`${init.method} ${path}`);
      if (path === '/api/v1/admin/leagues') return { ok: true, data: { id: 'lg-new' } } as never;
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

const buttons = () => [...container.querySelectorAll('button')];
async function press(label: string) {
  const button = buttons().find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await settle();
}

/** The row of the event's Tournament list that names `name`. */
const rowOf = (name: string) =>
  [...container.querySelectorAll('li')].find((li) => li.textContent?.startsWith(name))!;

async function openPage() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <NewLeaguePage />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
  const name = [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith('Name'))!
    .querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      name,
      'French League',
    );
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press('Spring Cup+');
}

describe('a team Tournament on the League create page', () => {
  it('is marked and not offered', async () => {
    await openPage();

    expect(rowOf('Team Longsword').textContent).toContain('League points belong to persons.');
    expect(rowOf('Team Longsword').querySelector('button')).toBeNull();
    expect(rowOf('Longsword Open').querySelector('button')?.textContent).toBe('Add');
  });

  it('a link the API refuses is named on screen before the page leaves', async () => {
    await openPage();
    await act(async () => rowOf('Longsword Open').querySelector('button')!.click());
    await press('Create league');

    expect(sent).toEqual(['POST /api/v1/admin/leagues', LINK]);
    expect(document.body.textContent).toContain(
      'Longsword Open was not linked: League points belong to persons.',
    );
    expect(push).toHaveBeenCalledWith('/admin/leagues/lg-new/edit?created=1');
  });
});
