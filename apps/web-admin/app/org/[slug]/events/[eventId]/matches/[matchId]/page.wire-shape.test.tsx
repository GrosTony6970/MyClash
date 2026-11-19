import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * The bout page reads the bout and its hits as the API hands them: the
 * database's column names (`red_score`, `first_striker_color`,
 * `red_score_delta`, `voided_reason`). It read camelCase names no answer
 * carries, so on the deployed stack every hit showed as "Clean hit — ? +0",
 * with no points line and no void reason, under a 0–0 score (2026-11-19).
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

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the bout page reads the API as it answers', () => {
  it('shows each hit with its side, its value and its points', async () => {
    page = await openEventPage(<MatchDetailPage />, { ...RUNNING_EVENT, ...boutReads(BOUT, null) });
    const text = document.body.textContent ?? '';

    expect(text).toContain('Clean hit — Fighter 1 +2');
    expect(text).not.toContain('— ? +');
    expect(text).toContain('F1+2');
  });

  it('shows why a hit was voided', async () => {
    page = await openEventPage(<MatchDetailPage />, { ...RUNNING_EVENT, ...boutReads(BOUT, null) });

    expect(document.body.textContent).toContain('Reason: Wrong fighter');
  });

  it('names the two fighters in the result panel', async () => {
    // The bout's row carries no fighter name; the summary does (SUMMARY: Ana Roux, Bo Lund).
    page = await openEventPage(<MatchDetailPage />, { ...RUNNING_EVENT, ...boutReads(BOUT, null) });
    const sides = [...document.querySelectorAll('select option')]
      .filter((option) => ['red', 'blue'].includes((option as HTMLOptionElement).value))
      .map((option) => option.textContent);

    expect(sides).toEqual(['Ana Roux', 'Bo Lund']);
  });

  it('shows the bout score in the header', async () => {
    page = await openEventPage(<MatchDetailPage />, { ...RUNNING_EVENT, ...boutReads(BOUT, null) });
    const scores = [...document.querySelectorAll('p.text-3xl span')].map((s) => s.textContent);

    expect(scores).toEqual(['5', '–', '3']);
  });
});
