import { expect } from '@playwright/test';
import type { Api } from './_api';
import { POINT_CAP, scoreMatch } from './_bracket';
import { poll } from './_pool';

/**
 * A team Tournament with its Pools drawn, nothing played: what the offline specs score a team
 * bout on (`06-offline-sync.spec.ts`, `40-offline-bout.spec.ts`), and the Pools and the single
 * elimination bracket that `49-team-tournament.spec.ts` plays to a champion.
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

/** The side of a bout whose team holds the lower seed: in these specs the lower seed wins. */
function lowerSeedColour(
  tournament: TeamTournament,
  redTeamId: string,
  blueTeamId: string,
): 'red' | 'blue' {
  const seedOf = (teamId: string): number => {
    const seed = tournament.teams.find((team) => team.id === teamId)?.seed;
    if (seed == null) throw new Error(`team ${teamId} is not a seeded team of this Tournament`);
    return seed;
  };
  return seedOf(redTeamId) < seedOf(blueTeamId) ? 'red' : 'blue';
}

/**
 * Play every Pool bout of a team Tournament through the API, the lower seed winning, so each
 * Pool ranks its teams in seed order. Each bout is scored as the pad scores it (`scoreMatch`):
 * the ruleset engine completes it at the point cap and records the winner team.
 */
export async function playTeamPools(api: Api, tournament: TeamTournament): Promise<void> {
  for (const bout of await readTeamPoolBouts(api, tournament.id)) {
    if (bout.status === 'completed') continue;
    if (!bout.red_team_id || !bout.blue_team_id)
      throw new Error(`Pool bout ${bout.id} lacks a team`);
    await scoreMatch(
      api,
      bout.id,
      lowerSeedColour(tournament, bout.red_team_id, bout.blue_team_id),
    );
  }
}

/**
 * One slot of `GET /tournaments/:id/bracket`, by side (`BracketSlotWire` in
 * `@myclash/types/bracket-side`). On a team side the Registration ids are null: the side keys
 * `redSideId` / `blueSideId` / `winnerSideId` carry the team ids.
 */
export interface TeamBracketSlot {
  id: string;
  round: number;
  position: number;
  status: string;
  matchId: string | null;
  redSideId: string | null;
  blueSideId: string | null;
  winnerSideId: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  source_a_ref: string | null;
  source_b_ref: string | null;
}

export async function readTeamBracket(api: Api, tournamentId: string): Promise<TeamBracketSlot[]> {
  const bracket = await api.json<{ slots: TeamBracketSlot[] }>(
    await api.get(`tournaments/${tournamentId}/bracket`),
  );
  return bracket.slots;
}

/**
 * A single elimination bracket of `size` teams, seeded from the finished Pools.
 *
 * Generated after the Pools, then populated explicitly: the populate the last Pool bout fires
 * only runs when a bracket already exists, so here there is no race with it. Single elimination
 * always carries a bronze bout (`single-elim.ts`).
 */
export async function generateTeamBracket(
  api: Api,
  tournamentId: string,
  size: number,
): Promise<TeamBracketSlot[]> {
  await api.ok(
    await api.post(`tournaments/${tournamentId}/generate-bracket`, {
      data: { phaseType: 'single_elim', qualifyCount: size },
    }),
  );
  await api.ok(await api.post(`tournaments/${tournamentId}/populate-bracket`, { data: {} }));
  return readTeamBracket(api, tournamentId);
}

/** A slot that can be fought now: a bout, both teams on it, not over. */
const playable = (slot: TeamBracketSlot): boolean =>
  slot.matchId !== null &&
  slot.redSideId !== null &&
  slot.blueSideId !== null &&
  slot.status !== 'completed' &&
  slot.status !== 'voided';

/**
 * Play a team bracket to its end through the API, the lower seed winning every bout.
 *
 * A fixed-point loop, as `playDoubleElim`: score every playable slot, then wait for the advance
 * (fire-and-forget on the server) to fill the next round. A slot scored to the cap that did not
 * complete fails loud, rather than being scored a second time.
 */
export async function playTeamBracket(
  api: Api,
  tournament: TeamTournament,
): Promise<TeamBracketSlot[]> {
  let slots = await readTeamBracket(api, tournament.id);
  const scored = new Set<string>();
  for (let pass = 0; pass < slots.length + 1; pass++) {
    const ready = slots.filter(playable);
    if (ready.length === 0) break;
    for (const slot of ready) {
      const colour = lowerSeedColour(tournament, slot.redSideId!, slot.blueSideId!);
      await scoreMatch(api, slot.matchId!, colour);
      scored.add(slot.id);
    }
    slots = await poll(
      () => readTeamBracket(api, tournament.id),
      (read) => read.some(playable) || read.every((slot) => slot.status === 'completed'),
      'the team bracket advances after a round',
    );
    const stuck = slots.filter((slot) => scored.has(slot.id) && slot.status !== 'completed');
    expect(stuck, 'a bracket bout scored to the cap did not complete').toEqual([]);
  }
  return slots;
}
