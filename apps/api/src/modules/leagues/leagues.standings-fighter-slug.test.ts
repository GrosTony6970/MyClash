/**
 * A name in a league's standings opens the fighter's page (quick win F21). Each row says where:
 * `fighterSlug`, the address of the public page, or null for a profile the public may not know
 * of (`publiclyKnownProfileIds`, ruling 174). That profile's page answers 404, so its name must
 * be no link, and its slug must not leave the server: the slug alone would say the page exists.
 *
 * The rule of "may the public know this profile" has its own tests
 * (`common/auth/hidden-entrants.profiles.test.ts`): it is mocked here, and these tests hold what
 * the standings ask it and what they do with its answer.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HiddenEntrants from '../../common/auth/hidden-entrants';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

const known = vi.hoisted(() => vi.fn());
vi.mock('../../common/auth/hidden-entrants', async (original) => ({
  ...(await original<typeof HiddenEntrants>()),
  publiclyKnownProfileIds: known,
}));

const LEAGUE = '11111111-1111-4111-8111-111111111111';

const LIVE: Record<'deleted_at' | 'merged_into_id' | 'account_deleted_at', string | null> = {
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
};

const ranked = (rank: number, profileId: string, name: string, slug: string, state = LIVE) => ({
  id: `rank-${rank}`,
  league_id: LEAGUE,
  ranking_group_key: 'longsword',
  rank,
  total_points: 100 - rank,
  participation_count: 1,
  medal_count: 0,
  double_hit_average: '0',
  per_tournament: [],
  global_person_id: profileId,
  global_persons: { display_name: name, slug, ...state, clubs: { name: 'Club A', city: 'Lyon' } },
});

const AT = '2026-09-01T10:00:00.000Z';
const RANKINGS = [
  ranked(1, 'gp-lea', 'Léa Martin', 'lea-martin'),
  ranked(2, 'gp-hidden', 'Paul Hidden', 'paul-hidden'),
  // Each is a profile the public may know of, and each has no page left (`isReachable`).
  ranked(3, 'gp-merged', 'Ada Merged', 'ada-merged', { ...LIVE, merged_into_id: 'gp-lea' }),
  ranked(4, 'gp-deleted', 'Bob Deleted', 'bob-deleted', { ...LIVE, deleted_at: AT }),
  ranked(5, 'gp-erased', 'Eve Erased', 'eve-erased', { ...LIVE, account_deleted_at: AT }),
];
const ALL_IDS = RANKINGS.map((row) => row.global_person_id);
const NO_PAGE = RANKINGS.slice(1).map((row) => row.global_persons.slug);

function build() {
  const db = mockSupabase({
    leagues: {
      rows: [
        {
          id: LEAGUE,
          slug: 'cup',
          status: 'published',
          public_visibility: true,
          season_year: 2026,
          scoring_config: {},
        },
      ],
    },
    league_tournament_links: { rows: [] },
    league_tournament_results: { rows: [] },
    league_rankings: { rows: RANKINGS },
    platform_roles: { rows: [{ user_id: 'u-padmin', role: 'platform_admin' }] },
  });
  const supabase = { service: db.service };
  const service = new LeaguesService(supabase as never, {} as never, {} as never);
  return { db, supabase, service, controller: new LeaguesController(service, supabase as never) };
}

type StandingsRow = Record<string, unknown> & { global_persons: Record<string, unknown> };
const rowsOf = (payload: { rows: unknown[] }) => payload.rows as StandingsRow[];

beforeEach(() => {
  known.mockReset();
  known.mockResolvedValue(new Set(ALL_IDS.filter((id) => id !== 'gp-hidden')));
});

describe("a standings row says where the fighter's public page is (F21)", () => {
  it("gives a known profile's slug as fighterSlug", async () => {
    const [lea] = rowsOf(await build().controller.standings(LEAGUE, {}));
    expect(lea!['fighterSlug']).toBe('lea-martin');
    expect(lea!.global_persons['display_name']).toBe('Léa Martin');
  });

  it('gives null for a profile the public may not know of, and its slug nowhere', async () => {
    const [, hidden] = rowsOf(await build().controller.standings(LEAGUE, {}));
    expect(hidden!['fighterSlug']).toBeNull();
    // The name stays: the standings showed it before, and they are the league's own record.
    expect(hidden!.global_persons['display_name']).toBe('Paul Hidden');
    expect(JSON.stringify(hidden)).not.toContain('paul-hidden');
  });

  it.each([
    [2, 'merged into another profile'],
    [3, 'deleted'],
    [4, 'erased with its account'],
  ])('gives null for a profile the public knows of that was %#: %s', async (index) => {
    const row = rowsOf(await build().controller.standings(LEAGUE, {}))[index]!;
    expect(row['fighterSlug']).toBeNull();
    expect(row.global_persons['display_name']).toBe(RANKINGS[index]!.global_persons.display_name);
  });

  it('sends the name and the club of a profile, and nothing else of it', async () => {
    for (const row of rowsOf(await build().controller.standings(LEAGUE, {}))) {
      expect(Object.keys(row.global_persons).sort()).toEqual(['clubs', 'display_name']);
      expect(row.global_persons['clubs']).toEqual({ name: 'Club A', city: 'Lyon' });
    }
  });

  it('asks once, for every ranked profile, with the service-role client', async () => {
    const { controller, supabase } = build();
    await controller.standings(LEAGUE, {});
    expect(known).toHaveBeenCalledTimes(1);
    expect(known).toHaveBeenCalledWith({ supabase }, ALL_IDS);
  });

  it("reads each ranked profile's slug, and what says the profile is still there", async () => {
    const { db, controller } = build();
    await controller.standings(LEAGUE, {});
    // The double ignores projections: only this pin sees a column go.
    expect(selectsFor(db.from, 'league_rankings')).toEqual([
      '*, global_persons(display_name, slug, deleted_at, merged_into_id, account_deleted_at, clubs(name, city))',
    ]);
  });

  it("answers the league admin's standings the same way", async () => {
    const rows = rowsOf(await build().service.adminStandings(LEAGUE, 'u-padmin'));
    expect(rows.map((row) => row['fighterSlug'])).toEqual(['lea-martin', null, null, null, null]);
    for (const slug of NO_PAGE) expect(JSON.stringify(rows)).not.toContain(slug);
  });

  it('fails when the question fails: never every name a link, never none', async () => {
    known.mockRejectedValue(new Error('profile read failed: connection reset'));
    await expect(build().controller.standings(LEAGUE, {})).rejects.toThrow(
      /^profile read failed: connection reset$/,
    );
  });
});
