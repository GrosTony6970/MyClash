import { ConflictException, Logger } from '@nestjs/common';
import { ForfeitRulesInForceSchema } from '@myclash/rulesets';
import {
  mergeForfeitRules,
  type ForfeitChanges,
  type ForfeitRulesInForce,
} from '@myclash/types/forfeit-rules';
import type { SupabaseService } from '../supabase/supabase.service';
import { tournamentCardRules } from './card-rules-pin';

/**
 * What a forfeit does in a Tournament: the forfeit rules of its penalty ruleset of now (rulings 63
 * and A/G), read off the same live row as its black card settings, with the Tournament's own
 * changes laid over both (ruling 65).
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

/** The code of a hand forfeit refused because the stored rules do not parse. */
export const FORFEIT_RULES_INVALID = 'forfeit_rules_invalid';

const logger = new Logger('ForfeitRules');

/** Stored forfeit rules that do not parse: a server error on a card, a 409 on a hand forfeit. */
export class ForfeitRulesInvalidError extends Error {
  constructor(readonly rulesetId: string) {
    super(`The forfeit rules of penalty ruleset ${rulesetId} do not parse`);
  }
}

function parsed(value: unknown, whose: string, rulesetId: string): ForfeitRulesInForce {
  const result = ForfeitRulesInForceSchema.safeParse(value);
  if (result.success) return result.data;
  logger.error(`Forfeit rules of ${whose} refused: ${result.error.message}`);
  throw new ForfeitRulesInvalidError(rulesetId);
}

/**
 * The rules in force under a card-rules row and a Tournament's changes. The API stores only parsed
 * values; one that does not parse came in another way (a hand-edited archive), and is an error,
 * never a default. The ruleset's own rules are parsed before the merge, which reads only the keys
 * it knows; the merged rules after it, so a changed black card reads one of its three values.
 */
export function forfeitRulesOf(
  cardRules: Row,
  changes: ForfeitChanges | null,
): ForfeitRulesInForce {
  return withChanges(rulesetForfeitRules(cardRules), changes, String(cardRules['id']));
}

/** A card-rules row's own forfeit rules and black card settings, parsed. */
function rulesetForfeitRules(cardRules: Row): ForfeitRulesInForce {
  const rulesetId = String(cardRules['id']);
  return parsed(
    {
      ...(cardRules['forfeit_rules'] as object),
      firstBlackCard: cardRules['first_black_card_forfeit'],
      secondBlackCard: cardRules['second_black_card_forfeit'],
    },
    `penalty ruleset ${rulesetId}`,
    rulesetId,
  );
}

function withChanges(
  ruleset: ForfeitRulesInForce,
  changes: ForfeitChanges | null,
  rulesetId: string,
): ForfeitRulesInForce {
  return changes
    ? parsed(mergeForfeitRules(ruleset, changes), `a Tournament on ${rulesetId}`, rulesetId)
    : ruleset;
}

/**
 * What the forfeit-rules reads answer: the ruleset's rules (what a Reset returns to), the
 * Tournament's stored changes, and the rules in force. Rules that do not parse answer `null` and
 * `invalid`, never an error: the screen that shows them is the one place a bad change is Reset.
 */
export interface ForfeitRulesAnswer {
  ruleset: ForfeitRulesInForce | null;
  changes: ForfeitChanges | null;
  inForce: ForfeitRulesInForce | null;
  invalid?: typeof FORFEIT_RULES_INVALID;
}

function readable<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof ForfeitRulesInvalidError) return null;
    throw error;
  }
}

export function forfeitRulesAnswer(
  cardRules: Row,
  changes: ForfeitChanges | null,
): ForfeitRulesAnswer {
  const rulesetId = String(cardRules['id']);
  const ruleset = readable(() => rulesetForfeitRules(cardRules));
  const inForce = ruleset && readable(() => withChanges(ruleset, changes, rulesetId));
  return inForce
    ? { ruleset, changes, inForce }
    : { ruleset, changes, inForce: null, invalid: FORFEIT_RULES_INVALID };
}

/**
 * The rules in force of a Tournament, its forfeit rules and black card settings, in one read of
 * its card rules of now and its changes. Every scorer reads them here.
 */
export async function cardAndForfeitRules(
  db: Client,
  tournamentId: string,
): Promise<{ forfeitRules: ForfeitRulesInForce }> {
  const { cardRules, changes } = await tournamentCardRules(db, tournamentId);
  return { forfeitRules: forfeitRulesOf(cardRules, changes) };
}

/** A hand forfeit's refusal of rules that do not parse: worded on the three forfeit screens. */
export function forfeitRulesRefusal(error: unknown): unknown {
  if (!(error instanceof ForfeitRulesInvalidError)) return error;
  return new ConflictException({
    message: 'The forfeit rules of this Tournament cannot be read: fix its penalty ruleset',
    code: FORFEIT_RULES_INVALID,
  });
}
