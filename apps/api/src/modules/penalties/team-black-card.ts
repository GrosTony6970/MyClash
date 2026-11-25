import { BLACK_CARD_REASONS } from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { TEAM_REPAIR_RECORD_COLUMNS } from '../matches/forfeit-side';
import type { MatchForfeitsService } from '../matches/match-forfeits.service';
import type { SupabaseService } from '../supabase/supabase.service';
import { teamBlackCardForfeit } from './card-side';
import { teamForfeitRules } from './forfeit-rules-in-force';

/**
 * A team black card loses this Match only (ruling 972): the team forfeits the bout through the
 * forfeit door's team path, under its penalty ruleset's own rules (`teamForfeitRules`, call 1).
 * The card door reads those rules BEFORE it writes the card, so a failed read leaves no card
 * saved with no forfeit; the forfeit runs after the card, as a Fighter's does.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;
type Actor = { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean };

export interface TeamCardDeps {
  db: Client;
  forfeits: MatchForfeitsService;
}

/** The bout a team card is on, as the card door read it. */
export interface TeamCardBout {
  id: string;
  status: string | null;
  tournamentId: string;
}

/**
 * The team's forfeit of this Match, under the rules the card door read before the card. A bout
 * already completed forfeits nothing (call 2): the card stays on record with its points.
 */
export async function forfeitForTeamBlackCard(
  deps: TeamCardDeps,
  bout: TeamCardBout,
  card: { teamId: string; note: string; rules: ForfeitRulesInForce },
  actor: Actor,
  causedAt?: string,
): Promise<void> {
  if (bout.status === 'completed') return;
  // No `canContinue`: a team has no status, and the forfeit door refuses it for a team (call 4).
  const { dto, cardEffect } = teamBlackCardForfeit(card.teamId, card.note);
  await deps.forfeits.createForfeit(bout.id, dto, actor, causedAt, {
    rules: card.rules,
    cardEffect,
  });
}

/** The live forfeit a black card of this team made on the bout, or null. */
async function liveTeamCardForfeit(db: Client, matchId: string, teamId: string) {
  const { data, error } = await db
    .from('match_forfeits')
    // What the team repair reads of it: the record goes to `repairTeamForfeit` as read.
    .select(TEAM_REPAIR_RECORD_COLUMNS)
    .eq('match_id', matchId)
    .eq('forfeiting_team_id', teamId)
    .in('reason', BLACK_CARD_REASONS)
    .is('voided_at', null);
  // Read as none, a resend forfeited the bout again over a record a first send left half done.
  if (error) throw new Error(`The forfeit of the team black card was not read: ${error.message}`);
  return ((data ?? []) as unknown as Row[])[0] ?? null;
}

/**
 * A live team black card sent again. Its first send may have saved the card and stopped before
 * the forfeit was whole; the tablet's resend is the only send left to finish it. A live forfeit of
 * the card goes through the one team repair (a bout still in play completed from the record, a
 * completed bout whose record kept no result stamped, then the bout handed on); with none, a bout
 * not completed is forfeited now. Each is safe to repeat. No review and no settle: a team has none.
 */
export async function replayTeamBlackCard(
  deps: TeamCardDeps,
  bout: TeamCardBout,
  card: { teamId: string; note: string },
  actor: Actor,
  causedAt?: string,
): Promise<void> {
  const record = await liveTeamCardForfeit(deps.db, bout.id, card.teamId);
  if (record) return deps.forfeits.repairTeamForfeit(record);
  const rules = await teamForfeitRules(deps.db, bout.tournamentId);
  await forfeitForTeamBlackCard(deps, bout, { ...card, rules }, actor, causedAt);
}
