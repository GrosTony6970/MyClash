import type { SupabaseService } from '../supabase/supabase.service';

/**
 * The review "a second black card" asks for, kept true to the Fighter's live black cards
 * (operator rulings, 2026-10-14).
 *
 * A new black card puts the review back to pending with the new count, whatever its state; a
 * confirmed disqualification stays confirmed. A review the card reopens remembers the answer it
 * had (`reopenedFrom`) and the card that reopened it (`reopenedBy`), so the void of THAT card can
 * give the answer back (`black-card-undo.ts`). "New" means a card the review has not counted: a
 * card sent again by its tablet is not new, and must not reopen a dismissed review.
 *
 * The write used to be one upsert with no conflict key and its error never read: a third card met
 * the table's unique row, failed in silence, and left the review as it was. Every error is now
 * read and thrown, as a server error.
 *
 * Two writers can meet: two cards written at once both read "no review", or the organiser
 * answers between this read and this write. The write is conditional on the review as it was read
 * (its `updated_at`), an insert meets the unique row (23505); either way the loser reads the cards
 * and the review again and writes once more. A second miss is thrown.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

export type ReviewStatus = 'pending' | 'confirmed' | 'dismissed';

export interface ReviewRead {
  id: string;
  status: ReviewStatus;
  black_card_count: number;
  payload_json: Row | null;
  updated_at: string;
}

const REVIEW_TYPE = 'second_black_card';
const UNIQUE_VIOLATION = '23505';

/** The review once `cardIds` are the live black cards and `card` is the one just written. */
export function nextReview(
  review: Pick<ReviewRead, 'status' | 'payload_json'>,
  cardIds: string[],
  card: string,
) {
  const payload = { ...(review.payload_json ?? {}) };
  const counted = Array.isArray(payload['penaltyIds']) ? (payload['penaltyIds'] as unknown[]) : [];
  const reopen = review.status === 'dismissed' && !counted.includes(card);
  return {
    status: reopen ? 'pending' : review.status,
    black_card_count: cardIds.length,
    payload_json: {
      ...payload,
      penaltyIds: cardIds,
      ...(reopen ? { reopenedFrom: 'dismissed', reopenedBy: card } : {}),
    },
  };
}

/**
 * The review once black card `voided` is taken back and `liveIds` are the cards left (rulings
 * 2026-10-14). Voiding the card that reopened a dismissed review gives the answer back; any other
 * void keeps the status, and the count follows the live cards. Below two live cards, a review
 * nobody ever answered goes (`'drop'`), and a reopened one goes back to its answer.
 */
export function reviewAfterVoid(
  review: Pick<ReviewRead, 'status' | 'payload_json'>,
  liveIds: string[],
  voided: string,
): ReturnType<typeof nextReview> | 'drop' {
  const payload = { ...(review.payload_json ?? {}) };
  const answer = payload['reopenedFrom'];
  const reopened = answer === 'dismissed';
  if (reopened && (payload['reopenedBy'] === voided || liveIds.length < 2)) {
    return {
      status: 'dismissed',
      black_card_count: liveIds.length,
      payload_json: { ...answeredPayload(payload), penaltyIds: liveIds },
    };
  }
  if (liveIds.length < 2 && review.status === 'pending') return 'drop';
  return {
    status: review.status,
    black_card_count: liveIds.length,
    payload_json: { ...payload, penaltyIds: liveIds },
  };
}

/** Takes the review away, as it was read. False: somebody wrote it in between. */
export async function dropReviewAsRead(db: Client, read: ReviewRead): Promise<boolean> {
  const { data, error } = await db
    .from('tournament_penalty_reviews')
    .delete()
    .eq('id', read.id)
    .eq('updated_at', read.updated_at)
    .select('id');
  if (error) throw new Error(`The black card review could not be removed: ${error.message}`);
  return ((data ?? []) as Row[]).length > 0;
}

export function sameReview(read: ReviewRead, next: ReturnType<typeof nextReview>): boolean {
  return (
    read.status === next.status &&
    read.black_card_count === next.black_card_count &&
    JSON.stringify(read.payload_json ?? {}) === JSON.stringify(next.payload_json)
  );
}

/** An organiser's answer is the review's own: what a card had reopened is forgotten. */
export function answeredPayload(payload: unknown): Row {
  const { reopenedFrom: _from, reopenedBy: _by, ...rest } = (payload ?? {}) as Row;
  return rest;
}

/** The ids of the Fighter's live black cards in the Tournament, oldest first. */
export async function liveBlackCardIds(
  db: Client,
  tournamentId: string,
  registrationId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('match_penalties')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('registration_id', registrationId)
    .eq('card', 'black')
    .eq('voided', false)
    .order('occurred_at', { ascending: true });
  if (error) throw new Error(`The black cards could not be read: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => String(row['id']));
}

export async function readReview(
  db: Client,
  tournamentId: string,
  registrationId: string,
): Promise<ReviewRead | null> {
  const { data, error } = await db
    .from('tournament_penalty_reviews')
    .select('id, status, black_card_count, payload_json, updated_at')
    .eq('tournament_id', tournamentId)
    .eq('registration_id', registrationId)
    .eq('review_type', REVIEW_TYPE)
    .maybeSingle();
  if (error) throw new Error(`The black card review could not be read: ${error.message}`);
  return (data as ReviewRead | null) ?? null;
}

/** Writes `next` over the review as it was read. False: somebody wrote it in between. */
export async function writeReviewOver(db: Client, read: ReviewRead, next: Row): Promise<boolean> {
  const { data, error } = await db
    .from('tournament_penalty_reviews')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', read.id)
    .eq('updated_at', read.updated_at)
    .select('id');
  if (error) throw new Error(`The black card review could not be written: ${error.message}`);
  return ((data ?? []) as Row[]).length > 0;
}

async function insertReview(
  db: Client,
  tournamentId: string,
  registrationId: string,
  cardIds: string[],
): Promise<boolean> {
  const { error } = await db.from('tournament_penalty_reviews').insert({
    tournament_id: tournamentId,
    registration_id: registrationId,
    review_type: REVIEW_TYPE,
    status: 'pending',
    black_card_count: cardIds.length,
    payload_json: { penaltyIds: cardIds },
    updated_at: new Date().toISOString(),
  });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`The black card review could not be written: ${error.message}`);
}

/** After black card `card` was written (or sent again): the review follows the live cards. */
export async function syncSecondBlackCardReview(
  db: Client,
  tournamentId: string,
  registrationId: string,
  card: string,
): Promise<void> {
  for (const lastTry of [false, true]) {
    const cards = await liveBlackCardIds(db, tournamentId, registrationId);
    if (cards.length < 2) return;
    const review = await readReview(db, tournamentId, registrationId);
    const next = review ? nextReview(review, cards, card) : null;
    // A card sent again that changes nothing writes nothing.
    if (review && next && sameReview(review, next)) return;
    const written =
      review && next
        ? await writeReviewOver(db, review, next)
        : await insertReview(db, tournamentId, registrationId, cards);
    if (written) return;
    if (lastTry) {
      throw new Error(
        `The black card review of registration ${registrationId} changed twice while it was written`,
      );
    }
  }
}
