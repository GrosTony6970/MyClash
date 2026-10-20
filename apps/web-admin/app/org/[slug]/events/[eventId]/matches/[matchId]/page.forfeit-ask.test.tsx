import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * What a black card does to the Fighter is its card rule's, never the official's answer
 * (rulings 54 and 58, 2026-10-20). So a forfeit "for a 1st black card" asks no "can continue?":
 * the server would ignore the answer.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', matchId: 'm1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/matches/m1',
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

const RUNNING_EVENT = { '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' } };
const RUNNING_BOUT = { ...BOUT, status: 'running', locked_at: null };

/** The forfeit form's reason, set the way a change of the select sets it. */
async function pickReason(reason: string) {
  const select = [...document.querySelectorAll('select')].find((field) =>
    [...field.options].some((option) => option.value === reason),
  )!;
  select.value = reason;
  await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
}

const asksCanContinue = () => document.body.textContent?.includes('Can continue') ?? false;

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the forfeit form of the bout page', () => {
  it('asks "can continue?" on an injury, and not on a 1st black card', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(RUNNING_BOUT, null),
    });

    await pickReason('injury');
    expect(asksCanContinue()).toBe(true);

    await pickReason('black_card_1');
    expect(asksCanContinue()).toBe(false);
  });
});
