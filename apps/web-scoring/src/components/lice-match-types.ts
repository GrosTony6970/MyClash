import type { TournamentScoringConfig } from '@myclash/types';

/**
 * Wire shape of `GET /api/v1/staff/lices/:liceId/matches`.
 *
 * Mirrors `apps/api/src/modules/staff/lice-matches.ts`. Hand-maintained: the
 * generated OpenAPI client carries the path but no response schema, because the
 * Nest route returns a plain object rather than a DTO class.
 */
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
  tournamentName: string | null;
  scoringConfig: TournamentScoringConfig | null;
  refereeNames: string[];
}

export interface LiceMatchesPayload {
  liceId: string;
  /** Raw, e.g. `Lice 4`. Render it as-is — never prefix it with "Lice". */
  liceName: string;
  event: { id: string; slug: string; name: string; status: string } | null;
  matches: LiceMatch[];
}
