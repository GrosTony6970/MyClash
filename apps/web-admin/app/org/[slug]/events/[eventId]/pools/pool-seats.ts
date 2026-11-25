/**
 * What the Pools page needs to know about a seat's kind: an individual Tournament seats
 * Registrations, a team Tournament seats teams (ADR-022). Pure, so the page stays a shell.
 */

/** A Tournament's kind of entrant (`tournaments.entrant_kind`). */
export type SeatKind = 'individual' | 'team';

/**
 * One entrant as the API lists it, in a Pool or waiting for one (`poolSeatOf`,
 * `apps/api/src/modules/phases/pool-seat.ts`).
 */
export interface PoolSeat {
  /** The side key: the Registration id, or the team id. The API refuses a seat with neither. */
  sideId: string;
  kind: SeatKind;
  /** Null for a team, never a team id. */
  registrationId: string | null;
  /** The side's label: the Fighter's name, or the team's. */
  name: string;
  /** Null for a team, which is not a person: read `name`. */
  personName: string | null;
  clubLabel: string | null;
  /** A team's colour name (`TOURNAMENT_COLORS`); null for a Fighter. */
  colour: string | null;
  logoUrl: string | null;
  hemaWeightedRating: number | null;
}

/** A seat in a Pool, with its seed there. */
export interface PoolMemberSeat extends PoolSeat {
  seed: number;
}

/** How a team Tournament spreads its teams over the Pools (ruling 971). */
export type TeamSpread = 'seed' | 'random';

/** The Tournament's kind as the Tournaments list sends it. An unread list reads individual. */
export function seatKindOf(tournament: { entrant_kind?: string | null } | null): SeatKind {
  return tournament?.entrant_kind === 'team' ? 'team' : 'individual';
}

/**
 * The body that seats one entrant in a Pool: a team by `teamId`, a Fighter by `registrationId`
 * (`AddPoolMemberDto`, exactly one).
 */
export function seatBody(seat: PoolSeat): { teamId: string } | { registrationId: string } {
  return seat.kind === 'team' ? { teamId: seat.sideId } : { registrationId: seat.sideId };
}

export interface GenerateSettings {
  mode: 'poolCount' | 'targetSize';
  poolCount: number;
  targetSize: number;
  schoolSeparation: boolean;
  skillBalance: boolean;
  teamSpread: TeamSpread;
  /** Fought bouts the operator agreed to discard; 0 for none. */
  discard: number;
}

/**
 * The generate-pools body for the kind. A team has no club and no rating, so a team body carries
 * the spread and not the club and skill switches, which the API refuses on a team Tournament
 * (`teamDrawOf`). A hidden field is not sent.
 */
export function generateBody(kind: SeatKind, s: GenerateSettings): Record<string, unknown> {
  const body: Record<string, unknown> =
    kind === 'team'
      ? { teamSpread: s.teamSpread }
      : { enforceSchoolSeparation: s.schoolSeparation, enforceSkillBalance: s.skillBalance };
  if (s.mode === 'poolCount') body['poolCount'] = s.poolCount;
  else body['targetSize'] = s.targetSize;
  if (s.discard > 0) body['discardScoredResults'] = s.discard;
  return body;
}

/** The i18n keys of the page's words that name the entrants. */
export interface SeatWords {
  countOne: string;
  countMany: string;
  dropHere: string;
  perPool: string;
  previewOne: string;
  previewMany: string;
  previewEmptyOne: string;
  previewEmptyMany: string;
  unassignedEmpty: string;
}

const WORDS: Record<SeatKind, SeatWords> = {
  individual: {
    countOne: 'organizer.pools.page.fightersCountSingular',
    countMany: 'organizer.pools.page.fightersCountPlural',
    dropHere: 'organizer.pools.page.dropFightersHere',
    perPool: 'organizer.pools.page.fightersPerPool',
    previewOne: 'organizer.pools.page.previewPoolsSingular',
    previewMany: 'organizer.pools.page.previewPoolsPlural',
    previewEmptyOne: 'organizer.pools.page.previewEmptySingular',
    previewEmptyMany: 'organizer.pools.page.previewEmptyPlural',
    unassignedEmpty: 'organizer.pools.page.unassignedEmpty',
  },
  team: {
    countOne: 'organizer.pools.page.teamsCountSingular',
    countMany: 'organizer.pools.page.teamsCountPlural',
    dropHere: 'organizer.pools.page.dropTeamsHere',
    perPool: 'organizer.pools.page.teamsPerPool',
    previewOne: 'organizer.pools.page.previewTeamPoolsSingular',
    previewMany: 'organizer.pools.page.previewTeamPoolsPlural',
    previewEmptyOne: 'organizer.pools.page.previewEmptyTeamsSingular',
    previewEmptyMany: 'organizer.pools.page.previewEmptyTeamsPlural',
    unassignedEmpty: 'organizer.pools.page.unassignedTeamsEmpty',
  },
};

export function seatWords(kind: SeatKind): SeatWords {
  return WORDS[kind];
}
