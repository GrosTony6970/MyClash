import { boutOutcomes } from '@myclash/rulesets';
import type { BoutOutcome } from '@myclash/rulesets';

/** The bout columns the outcome rule reads, whichever shape the caller holds. */
export type BoutSides = Parameters<typeof boutOutcomes>[0];

/**
 * Pure builder for the public fighter profile's "recent matches" strip (live +
 * recent completed). Kept free of Supabase so the win/loss/draw derivation —
 * which must agree with the paginated match history and the career recent-form —
 * is unit-testable in isolation.
 *
 * Outcome rule mirrors getPaginatedMatches: an explicit winner_registration_id
 * decides; absent one, the score decides (equal score = draw). Deriving from the
 * score alone (the old FE behaviour) could not tell a draw from a loss.
 */

/** A match row flattened from the PostgREST embed, plus the event context
 *  resolved from the fighter's OWN registration. */
export interface RecentMatchRow {
  id: string;
  status: string;
  scheduledAt: string | null;
  matchNumberLabel: string | null;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  winnerRegistrationId: string | null;
  /** `matches.end_reason` — 'max_doubles' means BOTH fighters LOST. */
  endReason: string | null;
  redScore: number;
  blueScore: number;
  eventName: string;
  eventSlug: string;
}

/** The public shape consumed by the web-public fighter page (`RecentMatch`). */
export interface ProfileRecentMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  outcome: 'win' | 'loss' | 'draw';
  eventName: string;
  eventSlug: string;
  scheduledAt: string | null;
}

/**
 * One bout from ONE fighter's side.
 *
 * The rule itself is `boutOutcomes` in `@myclash/rules`; this is the projection
 * onto the side the caller cares about, kept because "did I win it" is what all
 * three profile surfaces are actually asking.
 *
 * It takes the whole bout rather than a fighter-relative score pair on purpose.
 * The previous shape was five positional arguments with an OPTIONAL trailing
 * `endReason`, and one of the three callers kept passing four — so a max-doubles
 * bout read as a draw on the public person-schedule page while reading as a loss
 * everywhere else. A required object cannot be under-supplied by accident.
 */
export function deriveMatchOutcome(bout: BoutSides, side: 'red' | 'blue'): BoutOutcome {
  return boutOutcomes(bout)[side];
}

/** Map one raw match row to the public recent-match shape. `ownRegistrationIds`
 *  are this fighter's registrations (used to pick the fighter's side + resolve
 *  the opponent); `opponentNames` maps an opponent registration id → display
 *  name. */
export function buildProfileRecentMatch(
  row: RecentMatchRow,
  ownRegistrationIds: ReadonlySet<string>,
  opponentNames: ReadonlyMap<string, string>,
): ProfileRecentMatch {
  const isRed = row.redRegistrationId != null && ownRegistrationIds.has(row.redRegistrationId);
  const opponentRegistrationId = isRed ? row.blueRegistrationId : row.redRegistrationId;

  return {
    id: row.id,
    matchNumberLabel: row.matchNumberLabel ?? '',
    status: row.status,
    opponentName: opponentRegistrationId
      ? (opponentNames.get(opponentRegistrationId) ?? null)
      : null,
    redScore: row.redScore,
    blueScore: row.blueScore,
    isRed,
    outcome: deriveMatchOutcome(row, isRed ? 'red' : 'blue'),
    eventName: row.eventName,
    eventSlug: row.eventSlug,
    scheduledAt: row.scheduledAt,
  };
}
