/**
 * Wire shapes for the piste screen's pool + bracket views.
 *
 * Hand-maintained mirrors of `phases.service.ts` (`listPoolsWithMatches`,
 * `getTournamentBracket`) and `pool-standings.service.ts`, reached through the
 * staff-scoped routes. The generated OpenAPI client carries the paths but no
 * response schemas — those services return plain objects, not DTO classes.
 */
import type { TournamentBracketSlotWire } from '@myclash/types/bracket-side';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';

/** A referee on a pool's default crew (`scope_type='pool'`). */
export interface PoolReferee {
  /** A `referee_skills.id`. Render `roleLabel`, never this. */
  role: string;
  roleLabel: string;
  /** `referee_skills.color` design token (`'orange'`…), not a hex value. */
  roleColor: string;
  name: string;
}

/** One row of `GET /staff/lices/:liceId/tournaments/:id/pools`. */
export interface PoolWithMatches {
  poolId: string;
  poolName: string;
  /** Pool-scope defaults — the pool's crew, not any one match's override. */
  referees: PoolReferee[];
  /**
   * Every piste this pool's matches run on. An array because `pools` carries no
   * lice_id: a pool split across two pistes is legal and does happen.
   */
  liceNames: string[];
  matches: PoolMatchRow[];
}

export interface PoolMatchRow {
  id: string;
  /** snake_case: this payload is the admin Matches-tab shape, not camelised. */
  lice_id: string | null;
  lice_name: string | null;
  lice_number: number | null;
  red_name: string;
  blue_name: string;
  red_club_abbrev: string | null;
  blue_club_abbrev: string | null;
  red_score: number | null;
  blue_score: number | null;
  /** The recorded winner — what the list bolds. Authoritative over the two
   *  scores, which a forfeit or an override can invert. A team bout's winner is
   *  `winner_team_id`: exactly one of the two is set. */
  winner_registration_id: string | null;
  winner_team_id: string | null;
  /** Each side is a Registration or a team (0282): exactly one of the two per side. */
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id: string | null;
  blue_team_id: string | null;
  /** A team side's colour chip (a colour token); null for a Fighter's side. */
  red_team_color: string | null;
  blue_team_color: string | null;
  status: string;
  match_number_label: string | null;
  roundCode: string;
}

/** A standings column, defined by the tournament's ruleset — never hardcoded. */
export interface StandingsColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
  decimals?: number;
}

/**
 * `GET /tournaments/:id/pool-standings?mode=by-pool`.
 *
 * The service's response type is a union with NO discriminant field: `overall`
 * returns `rows`, `by-pool` returns `pools`. We only ever ask for `by-pool`.
 */
export interface PoolStandingsPayload {
  columns: StandingsColumn[];
  pools: Array<{
    poolId: string;
    poolName: string;
    status: string;
    rows: PoolStandingsRow[];
  }>;
}

/** `GET /staff/lices/:liceId/tournaments/:id/bracket` — null when none exists. */
export interface TournamentBracketPayload {
  rounds: number;
  bracketSize: number | null;
  phaseType: 'single_elim' | 'double_elim';
  wbRounds?: number | null;
  lbRounds?: number | null;
  bronzeSlotId?: string | null;
  /**
   * The slots as the bracket read declares them (`getTournamentBracket`, served through the staff
   * route): side ids, typed sides, and `winnerSideId`, the recorded winner the card bolds —
   * authoritative over the scores, which a forfeit or a `referee_decision` override can invert.
   */
  slots: TournamentBracketSlotWire[];
}
