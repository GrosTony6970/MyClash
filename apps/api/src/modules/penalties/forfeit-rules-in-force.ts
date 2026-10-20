import { ConflictException, Logger } from '@nestjs/common';
import { ForfeitRulesSchema } from '@myclash/rulesets';
import type { ForfeitRules } from '@myclash/types/forfeit-rules';
import type { SupabaseService } from '../supabase/supabase.service';
import { tournamentCardRules } from './card-rules-pin';

/**
 * What a forfeit does in a Tournament: the forfeit rules of its penalty ruleset of now (rulings 63
 * and A/G), read off the same live row as its black card settings.
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

/**
 * The forfeit rules a card-rules row holds. The API stores only parsed rules; a value that does not
 * parse came in another way (a hand-edited archive), and is an error, never a default.
 */
export function forfeitRulesOf(cardRules: Row): ForfeitRules {
  const parsed = ForfeitRulesSchema.safeParse(cardRules['forfeit_rules']);
  if (parsed.success) return parsed.data;
  const rulesetId = String(cardRules['id']);
  logger.error(`Forfeit rules of ${rulesetId} refused: ${parsed.error.message}`);
  throw new ForfeitRulesInvalidError(rulesetId);
}

/** The Tournament's card rules of now and the forfeit rules they hold, in one read. */
export async function cardAndForfeitRules(
  db: Client,
  tournamentId: string,
): Promise<{ cardRules: Row; forfeitRules: ForfeitRules }> {
  const cardRules = await tournamentCardRules(db, tournamentId);
  return { cardRules, forfeitRules: forfeitRulesOf(cardRules) };
}

/** A hand forfeit's refusal of rules that do not parse: worded on the three forfeit screens. */
export function forfeitRulesRefusal(error: unknown): unknown {
  if (!(error instanceof ForfeitRulesInvalidError)) return error;
  return new ConflictException({
    message: 'The forfeit rules of this Tournament cannot be read: fix its penalty ruleset',
    code: FORFEIT_RULES_INVALID,
  });
}
