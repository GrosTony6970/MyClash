import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import TournamentsPage from './page';

/**
 * A team Tournament's entrants on the Tournaments list are its teams (Team Tournaments, 1b-1).
 * The list read "Registered 0 / 8" beside 6 teams, while the 9th was refused tournament_full.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/tournaments',
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
vi.mock('./_components/AttachToLeaguePanel', () => ({ AttachToLeaguePanel: () => null }));

let page: OpenedPage;
afterEach(() => page.unmount());

/** The text of the Registered cell (the fourth) of the row of `name`. */
const registeredCell = (name: string) =>
  [...document.body.querySelectorAll('tbody tr')]
    .find((tr) => tr.querySelector('td')?.textContent?.startsWith(name))
    ?.querySelectorAll('td')[3];

describe('the Registered column of the Tournaments list', () => {
  it('counts a team Tournament its teams, worded and linked to its Teams page', async () => {
    page = await openEventPage(<TournamentsPage />, {
      [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
      [`/api/v1/events/${EVENT_ID}/tournaments`]: [
        {
          id: 't-1',
          name: 'Longsword',
          status: 'draft',
          entrant_kind: 'individual',
          registered: 7,
          max_participants: 16,
        },
        {
          id: 't-2',
          name: 'Team Longsword',
          status: 'draft',
          entrant_kind: 'team',
          registered: 0,
          teamCount: 6,
          max_participants: 8,
        },
      ],
    });

    const team = registeredCell('Team Longsword')!;
    expect(team.textContent).toBe('6 / 8 team(s)');
    expect(team.querySelector('a')?.getAttribute('href')).toBe(
      '/org/club/events/ev1/teams?tournamentId=t-2',
    );
    const individual = registeredCell('Longsword')!;
    expect(individual.textContent).toBe('7 / 16');
    expect(individual.querySelector('a')).toBeNull();
  });
});
