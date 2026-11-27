import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { MatchesTab } from './MatchesTab';

/**
 * The bouts tab of a team Pool. Its bouts' Registration columns are null; the view names the
 * teams in `red_name` / `blue_name` and sends their ids and colours (0284). The header counts
 * teams, each side shows its team's colour chip, and the bolded side is the recorded winner:
 * Paris, awarded the bout while behind on points.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('./build-scoring-href', () => ({
  buildMatchScoringHref: () => '#scoring',
  STAFF_APP_PREFIX: '',
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

/** One bout as `listPoolsWithMatches` maps it (apps/api/src/modules/phases/phases.service.ts). */
const teamBout = {
  id: 'M1',
  pool_id: 'pool-1',
  round_number: 1,
  red_registration_id: null,
  blue_registration_id: null,
  red_name: 'Lyon Blades',
  red_club_abbrev: null,
  blue_name: 'Paris Rapiers',
  blue_club_abbrev: null,
  red_score: 5,
  blue_score: 3,
  winner_registration_id: null,
  red_team_id: 'team-lyon',
  blue_team_id: 'team-paris',
  winner_team_id: 'team-paris',
  red_team_color: 'red',
  blue_team_color: 'blue',
  status: 'completed',
  lice_id: null,
  lice_name: null,
  lice_number: null,
  scheduled_at: null,
  match_number_label: 'M1',
  referees: [],
  roundCode: 'LSW-P1-M1',
};

const READS = {
  '/api/v1/tournaments/t-1/pools-with-matches': [
    { poolId: 'pool-1', poolName: 'Pool A', referees: [], liceNames: [], matches: [teamBout] },
  ],
  '/api/v1/tournaments/t-1': {},
  '/api/v1/events/ev1/lices': [],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/tournaments/t-1/pool-match-role-config': { roles: [] },
};

let page: OpenedPage;
afterEach(() => page.unmount());

async function open() {
  page = await openEventPage(
    <MatchesTab
      tournamentId="t-1"
      poolPhaseId="phase-1"
      slug="org"
      eventId="ev1"
      isReadOnly={false}
    />,
    READS,
  );
}

/** The name span of a side, by its text: the innermost span that holds it. */
const nameOf = (name: string) =>
  [...document.body.querySelectorAll('tbody span')].filter((s) => s.textContent === name).at(-1)!;

describe('the bouts tab of a team Pool', () => {
  it('counts the teams of the Pool', async () => {
    await open();
    expect(document.body.textContent).toContain('2 teams');
  });

  it('bolds the team awarded the bout while behind on points', async () => {
    await open();
    expect(nameOf('Paris Rapiers').className).toContain('font-bold');
    expect(nameOf('Lyon Blades').className).not.toContain('font-bold');
  });

  it('shows each team’s colour chip beside its name', async () => {
    await open();
    for (const name of ['Lyon Blades', 'Paris Rapiers']) {
      const side = nameOf(name).parentElement!;
      expect(side.querySelector('span.rounded-full')).not.toBeNull();
    }
  });
});
