import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, FORFEIT_RECORD, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * The bout page's forfeit panel says when the forfeit counted as a draw (ruling 104). Léa is
 * injured in a Pool bout and her penalty ruleset counts an injury as a draw: 0-0, no winner. A
 * forfeit whose rule keeps the score, stopped at 0-0, gives the bout to her opponent and reads
 * the same "Injury · 0–0" without the word.
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
const ENDED = { ...BOUT, red_score: 0, blue_score: 0 };
const record = (scorePolicy: string) => ({
  ...FORFEIT_RECORD,
  score_policy: scorePolicy,
  forfeiting_score: 0,
  opponent_score: 0,
});

/** The panel's line: the reason, the score and, on a draw, the word. */
const panelLine = () =>
  [...document.body.querySelectorAll('section p')]
    .map((p) => p.textContent ?? '')
    .find((text) => text.includes('0–0'));

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the forfeit panel of the bout page', () => {
  it('says Draw when the forfeit counted as a draw', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(ENDED, record('draw')),
    });

    expect(panelLine()).toContain('0–0 · Draw');
  });

  it('says no Draw for a forfeit that kept a 0-0 score', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(ENDED, record('keep_current')),
    });

    expect(panelLine()).toBeDefined();
    expect(panelLine()).not.toContain('Draw');
  });

  it('says it in French', async () => {
    page = await openEventPage(
      <MatchDetailPage />,
      { ...RUNNING_EVENT, ...boutReads(ENDED, record('draw')) },
      {},
      { locale: 'fr' },
    );

    expect(panelLine()).toContain('0–0 · Match nul');
  });
});
