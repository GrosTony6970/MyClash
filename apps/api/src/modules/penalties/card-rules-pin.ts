import type { BlackCardEffect, BlackCardReason } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * Which card rules a Tournament plays under now, and what a black card does under them. Plain
 * functions over the service client, so the card path (`PenaltiesService`) and the hand forfeit
 * (`MatchForfeitsService`) read the same rules the same way (rulings 54 and 58, 2026-10-20).
 *
 * A read that fails is an error, never the built-in: a black card reaches as far as the rules say.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

/** The columns of a card ruleset a card is priced and reached by, and its forfeit rules. */
const CARD_RULE_COLUMNS =
  'id, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit, forfeit_rules';

/**
 * The predicate that identifies the built-in row. `RulesetHashService.resolveEffectivePenalty`
 * and `PenaltiesService.loadBuiltInPenaltyBaseline` still hold their own copies.
 *
 * `.limit(1)` before `.maybeSingle()`: a second built-in row would otherwise null the whole
 * result and silently empty the picker again.
 */
export function builtInPenaltyRulesetQuery(db: Client, columns: string) {
  return db
    .from('penalty_rulesets')
    .select(columns)
    .eq('built_in', true)
    .is('owner_organization_id', null)
    .limit(1)
    .maybeSingle();
}

/** Id of the built-in default, without dragging its entries along. */
export async function loadBuiltInPenaltyRulesetId(db: Client): Promise<string | null> {
  const { data, error } = await builtInPenaltyRulesetQuery(db, 'id');
  // Read as "no built-in", a failed read refused every card of a bout that pins none.
  if (error) throw new Error('The built-in card rules were not read');
  return ((data as Row | null)?.['id'] as string | undefined) ?? null;
}

/** A read that fails is an error: read as none, a card was priced and reached by defaults. */
export async function loadPenaltyRulesetRow(db: Client, rulesetId: string): Promise<Row | null> {
  const { data, error } = await db
    .from('penalty_rulesets')
    .select(CARD_RULE_COLUMNS)
    .eq('id', rulesetId)
    .maybeSingle();
  if (error) throw new Error(`Card rules ${rulesetId} were not read: ${error.message}`);
  return (data as Row | null) ?? null;
}

/**
 * The id of a Tournament's card rules of now: its pin, else its Event's, else the built-in. One
 * resolver for the admin picker and for how far a black card reaches (ruling G); the copy of a
 * bout's rules pins the same way (`build_match_rules`, `card-pin-parity.test.ts`).
 */
export async function tournamentCardRulesetId(
  db: Client,
  tournamentId: string,
): Promise<string | null> {
  const { data: t, error } = await db
    .from('tournaments')
    .select('penalty_ruleset_id, event_id')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) {
    throw new Error(`The card rules of ${tournamentId} were not read: ${error.message}`);
  }
  const tour = t as { penalty_ruleset_id?: string | null; event_id?: string | null } | null;
  if (tour?.penalty_ruleset_id) return tour.penalty_ruleset_id;
  if (tour?.event_id) {
    const { data: ev, error: eventError } = await db
      .from('events')
      .select('penalty_ruleset_id')
      .eq('id', tour.event_id)
      .maybeSingle();
    if (eventError) {
      throw new Error(`The card rules of ${tour.event_id} were not read: ${eventError.message}`);
    }
    const evRulesetId =
      (ev as { penalty_ruleset_id?: string | null } | null)?.penalty_ruleset_id ?? null;
    if (evRulesetId) return evRulesetId;
  }
  return loadBuiltInPenaltyRulesetId(db);
}

/**
 * A Tournament's card rules of now, as a row. None is an error: the pin chain ends on the
 * built-in, so a missing row is a broken install, and read as defaults it would decide a card.
 */
export async function tournamentCardRules(db: Client, tournamentId: string): Promise<Row> {
  const id = await tournamentCardRulesetId(db, tournamentId);
  const row = id ? await loadPenaltyRulesetRow(db, id) : null;
  if (!row) throw new Error(`Tournament ${tournamentId} has no card rules`);
  return row;
}

/**
 * What the black card of `reason` does under `cardRules`: the 1st card's column, or the 2nd's.
 * Both columns are NOT NULL and CHECKed to the three values (migration 0054).
 */
export function blackCardEffectOf(cardRules: Row, reason: BlackCardReason): BlackCardEffect {
  const column =
    reason === 'black_card_2' ? 'second_black_card_forfeit' : 'first_black_card_forfeit';
  return cardRules[column] as BlackCardEffect;
}
