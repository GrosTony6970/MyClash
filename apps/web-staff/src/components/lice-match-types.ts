import type { TournamentScoringConfig } from '@myclash/types';

/**
 * Wire shape of `GET /api/v1/staff/lices/:liceId/matches`.
 *
 * Mirrors `apps/api/src/modules/staff/lice-matches.ts`. Hand-maintained: the
 * generated OpenAPI client carries the path but no response schema, because the
 * Nest route returns a plain object rather than a DTO class.
 */
/** One officiating referee, with the role's own catalogue colour. */
export interface LiceMatchReferee {
  name: string;
  /** Raw `referee_skills.id`; null on legacy assignments. */
  role: string | null;
  /** `referee_skills.name` — DATA, never an i18n key. */
  roleLabel: string | null;
  /** `referee_skills.color` design token (`'orange'`…), not a hex value. */
  roleColor: string;
}

export interface LiceMatch {
  id: string;
  /** `scheduled` | `running` | `paused` | `completed`. */
  status: string;
  poolId: string | null;
  scheduledAt: string | null;
  matchNumberLabel: string | null;
  roundCode: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  tournamentId: string | null;
  tournamentName: string | null;
  /** Tournament weapon — `BracketView` needs it to render a card's round code. */
  weapon: string | null;
  /** `pool` | `single_elim` | `double_elim` | `swiss`. */
  phaseType: string | null;
  scoringConfig: TournamentScoringConfig | null;
  referees: LiceMatchReferee[];
}

export interface LiceMatchesPayload {
  liceId: string;
  /** Raw, e.g. `Lice 4`. Render it as-is — never prefix it with "Lice". */
  liceName: string;
  event: { id: string; slug: string; name: string; status: string } | null;
  matches: LiceMatch[];
}
