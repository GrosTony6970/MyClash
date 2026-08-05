/**
 * Wire shapes for the piste screen's pool + bracket views.
 *
 * Hand-maintained mirrors of `phases.service.ts` (`listPoolsWithMatches`,
 * `getTournamentBracket`) and `pool-standings.service.ts`, reached through the
 * staff-scoped routes. The generated OpenAPI client carries the paths but no
 * response schemas — those services return plain objects, not DTO classes.
 */

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

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: string;
  /** Keyed by `StandingsColumn.key`. Shape varies with the ruleset. */
  stats: Record<string, number | string>;
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
    rows: StandingsRow[];
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
  slots: Array<{
    id: string;
    round: number;
    position: number;
    redFighterName: string | null;
    blueFighterName: string | null;
    redScore: number | null;
    blueScore: number | null;
    status: string;
    matchId: string | null;
    liceId?: string | null;
    /** Piste name for the card's pill. Null when the bout has no lice yet. */
    liceName?: string | null;
    /** `BracketReferee` from @myclash/ui — rendered under the card. */
    referees?: Array<{
      role: string | null;
      roleLabel?: string | null;
      displayName: string;
      status: string;
      skillColor: string;
    }>;
  }>;
}
