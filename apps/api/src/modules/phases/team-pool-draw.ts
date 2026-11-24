import { BadRequestException } from '@nestjs/common';
import { mulberry32, snakeSeed } from '@myclash/rules/scheduling';
import type { EntrantKind } from '../events/tournament-kind';

/**
 * How Pools of teams are drawn (decision 13 of the design, ruling 971). A team has no club and no
 * rating, so the club and skill spread of individual Pools does not apply: the organiser picks a
 * spread by seed (snake) or a random draw. The spread by the rating of named members lands in 1c.
 */
export type TeamSpread = 'seed' | 'random';

/** What a team draw stores in its phase's `config_json`: a random draw keeps its seed, to replay. */
export type TeamDraw = { teamSpread: 'seed' } | { teamSpread: 'random'; drawSeed: number };

/** A team as the draw reads it (`teams(id, seed, created_at)`). */
export interface DrawTeam {
  id: string;
  seed: number | null;
  created_at: string;
}

/** The fields of a Pool generation the team draw judges. */
export interface TeamDrawFields {
  teamSpread?: TeamSpread;
  seed?: number;
  enforceSchoolSeparation?: boolean;
  enforceSkillBalance?: boolean;
}

const refused = (field: string, message: string) =>
  new BadRequestException({ code: 'entrant_kind_field', field, message });

/**
 * The team draw a Pool generation asks for, or null for an individual Tournament. Throws 400 for a
 * field the kind refuses: a team spread on an individual Tournament; on a team Tournament, no
 * spread, a club or skill spread, or a draw seed with a spread by seed (it draws nothing).
 *
 * A random draw takes the body's `seed`, else `drawSeed()`, the server's. The individual path's
 * default of 42 (`localSearch`) is not a team default: a body with no seed gets a new draw.
 */
export function teamDrawOf(
  kind: EntrantKind,
  dto: TeamDrawFields,
  drawSeed: () => number,
): TeamDraw | null {
  if (kind !== 'team') {
    if (dto.teamSpread !== undefined) {
      throw refused('teamSpread', 'An individual Tournament does not take a team spread.');
    }
    return null;
  }
  if (dto.teamSpread === undefined) {
    throw refused('teamSpread', 'A team Tournament spreads its teams by seed or by random draw.');
  }
  for (const field of ['enforceSchoolSeparation', 'enforceSkillBalance'] as const) {
    if (dto[field] !== undefined) {
      throw refused(field, 'A team has no club and no rating to spread by.');
    }
  }
  if (dto.teamSpread === 'seed') {
    if (dto.seed !== undefined) {
      throw refused('seed', 'A spread by seed draws nothing, so it takes no draw seed.');
    }
    return { teamSpread: 'seed' };
  }
  return { teamSpread: 'random', drawSeed: dto.seed ?? drawSeed() };
}

/** By seed, a team with no seed last; then the first made; then by id, so the order is total. */
function bySeed(a: DrawTeam, b: DrawTeam): number {
  if (a.seed !== b.seed) {
    if (a.seed === null) return 1;
    if (b.seed === null) return -1;
    return a.seed - b.seed;
  }
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The teams in draw order. A random draw shuffles the teams in the order they come, which is id
 * order (the read orders them by id), with `mulberry32(drawSeed)`: one seed gives one draw,
 * whatever order the rows were written in.
 */
export function orderTeams(teams: readonly DrawTeam[], draw: TeamDraw): DrawTeam[] {
  if (draw.teamSpread === 'seed') return [...teams].sort(bySeed);
  const order = [...teams];
  const rng = mulberry32(draw.drawSeed);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * Each Pool's teams, in seat order. Both spreads number the draw order 1..N as each team's seed,
 * then snake it over the Pools (`snakeSeed`, which keeps that order: no team has a rating). No
 * local search: there is no club or rating to balance.
 */
export function teamPoolMap(
  teams: readonly DrawTeam[],
  poolCount: number,
  draw: TeamDraw,
): Map<number, string[]> {
  const entrants = orderTeams(teams, draw).map((team, index) => ({
    entrantId: team.id,
    clubId: null,
    skillRating: null,
    seed: index + 1,
  }));
  const pools = new Map<number, string[]>();
  for (const { poolIndex, entrantId } of snakeSeed(entrants, poolCount)) {
    pools.set(poolIndex, [...(pools.get(poolIndex) ?? []), entrantId]);
  }
  return pools;
}
