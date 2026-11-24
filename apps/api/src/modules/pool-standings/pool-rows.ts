import type { StandingsRow } from '@myclash/rules/results';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
import { sideKey } from '@myclash/types/side-key';
import { sideLabel, type TeamEmbed } from '../matches/side-label';

/**
 * The PostgREST projection the pools select returns.
 *
 * This is a database row shape — `pool_members`, `registration_id`, and the
 * embedded `persons` / `clubs` rows are column and relationship names, not
 * domain vocabulary. It sat in `standings-rows.ts` beside `applyRanking`; when
 * the ranking moved into `@myclash/rules` this stayed, because a row shape
 * crossing into the deterministic core is exactly what the seam exists to stop.
 *
 * A seat holds a Registration or a team (0282). `team_id` and `teams` are absent where only
 * Registrations are read: Swiss reuses the shape for its Fighters, and Swiss has no team path.
 */
export interface PoolWithMembers {
  id: string;
  name: string;
  pool_members: Array<{
    registration_id: string | null;
    team_id?: string | null;
    registrations: {
      id: string;
      persons: {
        id: string;
        given_name: string;
        family_name: string;
        clubs: { id: string; name: string; abbreviation: string | null } | null;
      };
    } | null;
    teams?: TeamEmbed | null;
  }>;
}

/** One Pool seat as standings read it. */
export type StandingsMember = PoolWithMembers['pool_members'][number];

/**
 * A completed bout as standings read it. Each side and the winner are a Registration or a team
 * (0282); the team twins are absent where only Registrations are read (Swiss).
 */
export interface CompletedBout {
  id: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id?: string | null;
  blue_team_id?: string | null;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  winner_team_id?: string | null;
  /** `matches.end_reason` — 'max_doubles' means BOTH fighters LOST. */
  end_reason: string | null;
}

/** The entrant key of a Pool seat: its side key. A seat holds one entrant (0282's check). */
export function seatKey(member: StandingsMember): string {
  const key = sideKey(member.registration_id, member.team_id);
  if (key === null) throw new Error('A Pool seat names neither a Registration nor a team');
  return key;
}

/** A bout's two side keys, or null while a side is not known: such a bout scores for nobody. */
export function boutSideKeys(
  bout: CompletedBout,
): { redSideId: string; blueSideId: string } | null {
  const redSideId = sideKey(bout.red_registration_id, bout.red_team_id);
  const blueSideId = sideKey(bout.blue_registration_id, bout.blue_team_id);
  return redSideId === null || blueSideId === null ? null : { redSideId, blueSideId };
}

/**
 * A ranked row with its side's kind, colour and logo (`sideLabel`): the team chip of the
 * standings. Rows are ranked first, then given these; `entrantId` is the seat's side key.
 */
export function withSideOf(pools: PoolWithMembers[]): (row: StandingsRow) => PoolStandingsRow {
  const labels = new Map(
    pools.flatMap((pool) =>
      pool.pool_members.map((member) => {
        const label = sideLabel(member.registrations, member.teams ?? null);
        return [label.id, label] as const;
      }),
    ),
  );
  return (row) => {
    // Every row is one of these seats: compute-rows keys its rows by the same side key.
    const label = labels.get(row.entrantId)!;
    return { ...row, kind: label.kind, colour: label.colour, logoUrl: label.logoUrl };
  };
}
