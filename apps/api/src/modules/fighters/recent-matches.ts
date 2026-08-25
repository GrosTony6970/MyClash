import { isDoubleLossBout } from '@myclash/rulesets';

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

/** Winner-aware outcome from the fighter's perspective. An explicit winner wins;
 *  with no winner recorded, an equal score is a draw, otherwise the higher score
 *  wins. */
export function deriveMatchOutcome(
  myScore: number,
  opponentScore: number,
  winnerRegistrationId: string | null,
  myRegistrationId: string | null,
  endReason: string | null = null,
): 'win' | 'loss' | 'draw' {
  // FIRST, because a double loss is 0-0 with no winner and is therefore
  // indistinguishable from a draw by either test below it.
  if (isDoubleLossBout(endReason)) return 'loss';
  if (!winnerRegistrationId) {
    if (myScore === opponentScore) return 'draw';
    return myScore > opponentScore ? 'win' : 'loss';
  }
  return winnerRegistrationId === myRegistrationId ? 'win' : 'loss';
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
  const myRegistrationId = isRed ? row.redRegistrationId : row.blueRegistrationId;
  const opponentRegistrationId = isRed ? row.blueRegistrationId : row.redRegistrationId;
  const myScore = isRed ? row.redScore : row.blueScore;
  const opponentScore = isRed ? row.blueScore : row.redScore;

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
    outcome: deriveMatchOutcome(
      myScore,
      opponentScore,
      row.winnerRegistrationId,
      myRegistrationId,
      row.endReason,
    ),
    eventName: row.eventName,
    eventSlug: row.eventSlug,
    scheduledAt: row.scheduledAt,
  };
}
