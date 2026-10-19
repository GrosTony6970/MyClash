import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../../archived-page.fixtures';
import { button, TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW } from './page.fixtures';
import TournamentSettingsPage from './page';

/**
 * The Locks tab shows the auto-lock a Tournament has: the row's `lock_config_json`, and for a key
 * the row lacks, what the auto-lock worker applies (`DEFAULT_TOURNAMENT_LOCK_CONFIG`). It read a
 * key the API never sends, so it showed "off, 30 min" for every Tournament, and an untouched Save
 * turned auto-lock off.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
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

const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;

let page: OpenedPage;
let saved: unknown[];
afterEach(() => page.unmount());

async function openLocks(lockConfig: unknown) {
  window.history.replaceState(null, '', '/#locks');
  const reads = {
    ...TOURNAMENT_READS,
    [TOURNAMENT]: { ...TOURNAMENT_ROW, lock_config_json: lockConfig },
  };
  page = await openEventPage(<TournamentSettingsPage />, reads);
  saved = [];
  const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
    if (!init?.method || init.method === 'GET') return read(base, path, init);
    saved.push(init.body);
    return { ok: true, data: {} } as Awaited<ReturnType<typeof ApiClient.apiRequest>>;
  });
}

const switches = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
const shown = () => ({
  on: switches().map((s) => s.getAttribute('aria-checked')),
  delay: document.body.querySelector<HTMLInputElement>('input[type="number"]')!.value,
});

describe('the Locks tab', () => {
  it("shows the Tournament's own auto-lock, and an untouched Save sends it back", async () => {
    const stored = {
      autoLockEnabled: false,
      autoLockDelayMinutes: 45,
      autoLockCompletedPools: true,
      autoLockCompletedBrackets: false,
    };
    await openLocks(stored);
    expect(shown()).toEqual({ on: ['false', 'true', 'false'], delay: '45' });

    await act(async () => button('Save changes').click());
    await page.settle();
    expect(saved).toEqual([{ lockConfig: stored }]);
  });

  it('shows what the auto-lock worker applies for a key the row lacks', async () => {
    await openLocks(null);
    expect(shown()).toEqual({ on: ['true', 'true', 'true'], delay: '15' });
  });
});
