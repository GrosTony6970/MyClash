import { rankRandom, type RankedEntrant } from '@myclash/rules/results';
import {
  ratingNeedsNamedMembers,
  teamTournamentNotSupported,
} from '../../common/entrant-kind-refusal';
import type { SeedingStrategy } from './dto/reseed-bracket.dto';
import { orderTeams, type DrawTeam } from './team-pool-draw';

/**
 * The Round-1 order of a team bracket when no Pool standings decide it (ruling 982, call 3).
 *
 * A team's seed sets the ORDER only: the teams in the order the Pool draw gives them (`orderTeams`
 * by seed: seed, then the first made, then id), ranked 1..N by that order. The stored seed is never
 * the rank: `teams.seed` is not unique and may skip numbers, and the seeding plan keeps one entrant
 * per rank, so a repeated seed would drop a team and a seed above the bracket size would place none.
 */

/**
 * Throws the named 409 for a strategy a team bracket does not take, before anything is read: a
 * rating needs the named members (1c-2), and Swiss takes no teams.
 */
export function assertTeamSeeding(strategy: SeedingStrategy): void {
  if (strategy === 'by-rating') throw ratingNeedsNamedMembers();
  if (strategy === 'by-swiss-rank') {
    throw teamTournamentNotSupported(
      'A team Tournament has no Swiss phase to seed a bracket from.',
    );
  }
}

/** The teams by seed, ranked 1..N in that order. */
export function rankTeamsBySeed(teams: readonly DrawTeam[]): RankedEntrant[] {
  return orderTeams(teams, { teamSpread: 'seed' }).map((team, index) => ({
    rank: index + 1,
    entrantId: team.id,
  }));
}

/** A shuffle of the teams that one seed replays (`rankRandom`). */
export function rankTeamsRandom(teams: readonly DrawTeam[], prngSeed: number): RankedEntrant[] {
  return rankRandom(
    teams.map((team) => ({ id: team.id, seed: null, bibNumber: null })),
    prngSeed,
  );
}
