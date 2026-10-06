import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import type { MatchForfeitsService } from '../matches/match-forfeits.service';
import type { SupabaseService } from '../supabase/supabase.service';

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

export const BLACK_CARD_UNDO_REFUSED = 'black_card_undo_refused';

const logger = new Logger('BlackCardUndo');

const refused = (message: string, cause?: unknown) =>
  new ConflictException({ message, code: BLACK_CARD_UNDO_REFUSED }, { cause });

/** A read that failed decides nothing: a plain Error, never "no row". */
function rowsOf(what: string, result: { data: unknown; error: { message: string } | null }): Row[] {
  if (result.error) throw new Error(`${what} could not be read: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

/** That Fighter's other live black cards, on this bout or in the whole Tournament. */
async function otherLiveBlackCards(db: Client, card: Row, on: 'match_id' | 'tournament_id') {
  const cards = await db
    .from('match_penalties')
    .select('id')
    .eq(on, card[on] as string)
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
  if ((await otherLiveBlackCards(db, card, 'match_id')) > 0) return null;
  const forfeits = await db
    .from('match_forfeits')
    .select('id, replacement_registration_id, created_at')
    .eq('match_id', card['match_id'] as string)
    .eq('forfeiting_registration_id', card['registration_id'] as string)
    .in('reason', ['black_card_1', 'black_card_2'])
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
 * The three things `voidForfeit` does not look at. A reserve in the Fighter's
 * place is not undone by it (it never writes `bracket_slots`). A later forfeit
 * of the Fighter stands on the status this one would overwrite. A review an
 * organiser CONFIRMED is his decision that the Fighter is out: restoring the
 * status the forfeit found would overturn it from a scorekeeper's tablet.
 */
async function assertUndoable(db: Client, forfeit: Row, card: Row): Promise<void> {
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
export async function takeBackBlackCardForfeit(
  deps: { db: Client; forfeits: MatchForfeitsService },
  card: Row,
  actor: Actor,
): Promise<void> {
  const forfeit = await blackCardForfeit(deps.db, card);
  if (!forfeit) return;
  await assertUndoable(deps.db, forfeit, card);
  try {
    await deps.forfeits.voidForfeit(forfeit['id'] as string, actor);
  } catch (err) {
    // Its 400s: a bout this one feeds was fought, the bout was fought again.
    // An over Event and a lock are refused before this is asked.
    if (!(err instanceof BadRequestException)) throw err;
    throw refused(err.message, err);
  }
}

/**
 * The review "a second black card" asked for, while nobody has answered it,
 * goes with the card that asked: fewer than two live ones remain.
 */
export async function dropSpentBlackCardReview(db: Client, card: Row): Promise<void> {
  if (card['card'] !== 'black') return;
  // Never throws: the card is voided by now, and the answer must say so.
  try {
    if ((await otherLiveBlackCards(db, card, 'tournament_id')) >= 2) return;
    const { error } = await db
      .from('tournament_penalty_reviews')
      .delete()
      .eq('tournament_id', card['tournament_id'] as string)
      .eq('registration_id', card['registration_id'] as string)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
  } catch (err) {
    logger.warn(
      `The second black card review of registration ${String(card['registration_id'])} was not removed`,
      err,
    );
  }
}
