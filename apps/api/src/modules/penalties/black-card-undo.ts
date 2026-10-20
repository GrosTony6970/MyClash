import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { BLACK_CARD_REASONS } from '@myclash/rulesets';
import type { FrozenResultsGuard } from '../matches/frozen-results.guard';
import type { MatchForfeitsService } from '../matches/match-forfeits.service';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  dropReviewAsRead,
  liveBlackCardIds,
  readReview,
  reviewAfterVoid,
  sameReview,
  writeReviewOver,
} from './second-black-card-review';

/**
 * Taking a black card back takes back what the card did (ruling 319).
 *
 * A black card ends its bout as a forfeit, and can put its Fighter out of the
 * Tournament. A void that removed the card alone leaves both standing: the
 * recompute does not touch a bout a live forfeit record holds (ruling 322).
 *
 * So the void of the card goes to `MatchForfeitsService.voidForfeit` first,
 * the one remedy that restores the bout, the bracket, the Fighter's status
 * and the Pool bouts forfeited with it. Whole or not at all: where that
 * remedy cannot run, the card stays, with ONE coded refusal the pad words.
 *
 * Not the rule of the Reopen button, which still refuses such a bout: a
 * referee who reopens to fix an entry has not asked for the card back.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;
type Actor = { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean };
type Deps = {
  db: Client;
  forfeits: MatchForfeitsService;
  /** Optional as in `PenaltiesService`, for the same direct-construction tests. */
  frozenResults?: Pick<FrozenResultsGuard, 'isEventOver'>;
};

export const BLACK_CARD_UNDO_REFUSED = 'black_card_undo_refused';

const logger = new Logger('BlackCardUndo');

const refused = (message: string, cause?: unknown) =>
  new ConflictException({ message, code: BLACK_CARD_UNDO_REFUSED }, { cause });

/** A read that failed decides nothing: a plain Error, never "no row". */
function rowsOf(what: string, result: { data: unknown; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error(`${what} could not be read: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

/** That Fighter's other live black cards on this bout. */
async function otherLiveBlackCardsOnBout(db: Client, card: Row) {
  const cards = await db
    .from('match_penalties')
    .select('id')
    .eq('match_id', card['match_id'] as string)
    .eq('registration_id', card['registration_id'] as string)
    .eq('card', 'black')
    .eq('voided', false)
    .neq('id', card['id'] as string);
  return rowsOf('The black cards', cards).length;
}

/**
 * The live forfeit this black card made on its bout, or null.
 *
 * Null too while ANOTHER live black card of that Fighter is on the bout: a
 * black card given on an ended bout is saved and its own forfeit refused, so
 * the record there is still earned by the first.
 */
async function blackCardForfeit(db: Client, card: Row): Promise<Row | null> {
  if (card['card'] !== 'black') return null;
  if ((await otherLiveBlackCardsOnBout(db, card)) > 0) return null;
  const forfeits = await db
    .from('match_forfeits')
    .select('id, replacement_registration_id, created_at')
    .eq('match_id', card['match_id'] as string)
    .eq('forfeiting_registration_id', card['registration_id'] as string)
    .in('reason', BLACK_CARD_REASONS)
    .is('voided_at', null);
  return rowsOf('The forfeit of the black card', forfeits)[0] ?? null;
}

/**
 * Has something put this Fighter out AFTER this forfeit? `voidForfeit` writes
 * back the status the forfeit FOUND, whatever came since: taking back a first
 * black card would put back in a Fighter a second one disqualified. The bouts
 * this forfeit closed itself (its children) are its own and go with it.
 */
async function forfeitedAgainSince(db: Client, forfeit: Row, card: Row): Promise<boolean> {
  const others = await db
    .from('match_forfeits')
    .select('id, parent_forfeit_id, created_at')
    .eq('tournament_id', card['tournament_id'] as string)
    .eq('forfeiting_registration_id', card['registration_id'] as string)
    .is('voided_at', null)
    .neq('id', forfeit['id'] as string);
  const made = Date.parse(String(forfeit['created_at']));
  return rowsOf('The other forfeits of the fighter', others).some(
    (other) =>
      other['parent_forfeit_id'] !== forfeit['id'] &&
      Date.parse(String(other['created_at'])) > made,
  );
}

/**
 * The four things `voidForfeit` does not look at. An Event that is over
 * (ruling 337): the void hands the bout back as the forfeit found it, running
 * or paused, with the Pool bouts forfeited beside it, and there the clock and
 * the pad are refused for everybody, so nobody could end them again. A fact
 * of the Event, with no super admin bypass: a super admin is the one caller
 * who gets this far. A reserve in the Fighter's place is not undone by it (it
 * never writes `bracket_slots`). A later forfeit of the Fighter stands on the
 * status this one would overwrite. A review an organiser CONFIRMED is his
 * decision that the Fighter is out: restoring the status the forfeit found
 * would overturn it from a scorekeeper's tablet.
 */
async function assertUndoable(deps: Deps, forfeit: Row, card: Row): Promise<void> {
  const { db } = deps;
  if (await deps.frozenResults?.isEventOver(card['match_id'] as string)) {
    throw refused('The Event is over: nobody could end the bouts this black card closed');
  }
  if (forfeit['replacement_registration_id']) {
    throw refused('A reserve took the place of the fighter this black card put out');
  }
  if (await forfeitedAgainSince(db, forfeit, card)) {
    throw refused('A later forfeit of this fighter stands on the one this black card made');
  }
  const confirmed = await db
    .from('tournament_penalty_reviews')
    .select('id')
    .eq('tournament_id', card['tournament_id'] as string)
    .eq('registration_id', card['registration_id'] as string)
    .eq('status', 'confirmed');
  if (rowsOf('The black card review', confirmed).length > 0) {
    throw refused('An organiser confirmed the disqualification this black card asked for');
  }
}

/**
 * Asked by the card's void BEFORE its own write. Every refusal of
 * `voidForfeit` comes before its first write too, so a refused undo leaves
 * the forfeit and the card as they were.
 */
export async function takeBackBlackCardForfeit(deps: Deps, card: Row, actor: Actor): Promise<void> {
  const forfeit = await blackCardForfeit(deps.db, card);
  if (!forfeit) return;
  await assertUndoable(deps, forfeit, card);
  try {
    await deps.forfeits.voidForfeit(forfeit['id'] as string, actor);
  } catch (err) {
    // Its 400s: a bout this one feeds was fought, the bout was fought again.
    // An over Event and a lock are refused before this is asked: by the card's
    // own door for who may not correct there, by `assertUndoable` for who may.
    if (!(err instanceof BadRequestException)) throw err;
    throw refused(err.message, err);
  }
}

/**
 * The review "a second black card" asked for follows the cards left once a black card is
 * voided (`reviewAfterVoid`): a reopened review gets its answer back once every live card is one
 * the answer covered; a review nobody answered goes once fewer than two live cards remain; otherwise
 * the count follows. Written over the review as it was read, once more if it moved.
 */
export async function dropSpentBlackCardReview(db: Client, card: Row): Promise<void> {
  if (card['card'] !== 'black') return;
  const tournamentId = card['tournament_id'] as string;
  const registrationId = card['registration_id'] as string;
  // Never throws: the card is voided by now, and the answer must say so.
  try {
    for (const lastTry of [false, true]) {
      // The voided card by its id too: this runs right after its own write.
      const live = (await liveBlackCardIds(db, tournamentId, registrationId)).filter(
        (id) => id !== card['id'],
      );
      const review = await readReview(db, tournamentId, registrationId);
      if (!review) return;
      const next = reviewAfterVoid(review, live);
      if (next !== 'drop' && sameReview(review, next)) return;
      const written =
        next === 'drop'
          ? await dropReviewAsRead(db, review)
          : await writeReviewOver(db, review, next);
      if (written) return;
      if (lastTry) throw new Error('the review changed twice while it was written');
    }
  } catch (err) {
    logger.warn(
      `The second black card review of registration ${String(card['registration_id'])} was not brought up to date`,
      err,
    );
  }
}
