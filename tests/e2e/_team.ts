import { expect } from '@playwright/test';
import type { Api } from './_api';
import { POINT_CAP } from './_bracket';

/**
 * A team Tournament with its Pools drawn, nothing played: what the offline specs score a team
 * bout on (`06-offline-sync.spec.ts`, `40-offline-bout.spec.ts`).
 *
 * Built through the routes slice 1b-1 shipped, as an organiser does it: the Tournament with
 * `entrantKind: 'team'` and a default team size, its teams (`POST tournaments/:id/teams`), then
 * the Pools spread by seed (`generate-pools` with `teamSpread: 'seed'`). A team Tournament takes
 * no club or skill spread, so the body sends neither (`team-pool-draw.ts`).
 *
 * The teams are made up and have no members: in slice 1b a team's seats are numbered by its
 * size, never named (ruling 973). Deliberately free of workspace-package imports, like its
 * siblings.
 */

/** One team, as `TEAM_COLUMNS` (`teams.service.ts`) returns it. */
export interface Team {
  id: string;
  name: string;
  seed: number | null;
  logo_url: string | null;
}

export interface TeamTournament {
  id: string;
  slug: string;
  /** In seed order: index 0 is seed 1. */
  teams: Team[];
}

/** One team Pool bout, as `GET /tournaments/:id/pools-with-matches` projects it. */
export interface TeamPoolBout {
  id: string;
  status: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id: string | null;
  blue_team_id: string | null;
  winner_team_id: string | null;
}

/** The made-up team names, seed 1 first. */
const TEAM_NAMES = ['Alder Blades', 'Birch Guard', 'Cedar Hall', 'Damson Ward'];

/** Every team gets this size unless the caller asks for another. */
const TEAM_SIZE = 3;

/**
 * A team Tournament of four teams seeded 1 to 4, in `poolCount` Pools by seed. With two Pools
 * the snake puts seeds 1 and 4 in one and 2 and 3 in the other: one bout each.
 */
export async function createTeamPoolTournament(
  api: Api,
  eventId: string,
  opts: { name: string; slug: string; poolCount: number },
): Promise<TeamTournament> {
  const tournament = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/tournaments`, {
      data: {
        name: opts.name,
        slug: opts.slug,
        weapon: 'longsword',
        color: 'red',
        entrantKind: 'team',
        teamDefaultSize: TEAM_SIZE,
      },
    }),
  );
  // The cap by PATCH, as `createBracketTournament` pins it (its comment says why).
  await api.ok(
    await api.patch(`tournaments/${tournament.id}`, {
      data: { rulesetConfig: { matchFormat: { pointCap: POINT_CAP } } },
    }),
  );

  const teams: Team[] = [];
  for (const [index, name] of TEAM_NAMES.entries()) {
    teams.push(
      await api.json<Team>(
        await api.post(`tournaments/${tournament.id}/teams`, { data: { name, seed: index + 1 } }),
      ),
    );
  }

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, {
      data: { poolCount: opts.poolCount, teamSpread: 'seed' },
    }),
  );
  return { id: tournament.id, slug: opts.slug, teams };
}

/** Every Pool bout of a team Tournament, flattened across its Pools. */
export async function readTeamPoolBouts(api: Api, tournamentId: string): Promise<TeamPoolBout[]> {
  const pools = await api.json<Array<{ matches?: TeamPoolBout[] }>>(
    await api.get(`tournaments/${tournamentId}/pools-with-matches`),
  );
  return pools.flatMap((pool) => pool.matches ?? []);
}

/**
 * One team Pool bout that nobody started: two teams on it, no Fighter on either side, and the
 * server says "scheduled".
 */
export async function aScheduledTeamBout(
  api: Api,
  eventId: string,
  key: string,
): Promise<{ tournament: TeamTournament; bout: TeamPoolBout }> {
  const token = `${key}-${Date.now().toString(36)}`;
  const tournament = await createTeamPoolTournament(api, eventId, {
    name: `Team ${key} ${token}`,
    slug: `team-${token}`,
    poolCount: 2,
  });
  const bout = (await readTeamPoolBouts(api, tournament.id)).find(
    (match) => match.red_team_id && match.blue_team_id,
  );
  if (!bout) throw new Error('no team Pool bout was generated');
  expect({ red: bout.red_registration_id, blue: bout.blue_registration_id }).toEqual({
    red: null,
    blue: null,
  });
  expect(bout.status).toBe('scheduled');
  return { tournament, bout };
}
