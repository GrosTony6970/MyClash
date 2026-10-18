import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The rules stamped onto every generated `matches` row: the copy of its Tournament's rules it is
 * scored by (`match_rules_id`, migration 0229), and, until the foundation's last commit drops
 * them, the copy's engine pair and hash on the row's own three columns.
 *
 * Match generation used to hardcode `TF_v1`/`1.0.0` at every insert site,
 * so non-TF tournaments (Generic_PointsCap, org custom formulas) had their
 * matches SCORED with the wrong engine while standings were computed from
 * the tournament's real ruleset — two engines for the same data.
 */
export interface MatchRulesetStamp {
  /** The copy of the Tournament's rules of now the bout points at; frozen from its start. */
  match_rules_id: string;
  ruleset_code: string;
  ruleset_version: string;
  /** The tournament's effective (scoring, penalty) content hash in force when
   *  the bout was stamped: at generation, and again at each change of the
   *  Tournament's rules while the bout has not started. Frozen from its start,
   *  so a scored bout records which behaviour produced it. Null until the
   *  tournament has been stamped. */
  ruleset_content_hash: string | null;
}

/** `stamp_match_rules` raises this when the Tournament is gone (0229). */
const NO_TOURNAMENT = 'P0002';

/**
 * The copy of a Tournament's rules of now, made or found by the database's one writer of the
 * copies (`stamp_match_rules`, 0229), which also points the Tournament's bouts not started at it.
 * The copy's engine pair is the Tournament's, checked when it was set (`usableRulesetVersion`): a
 * copy with no pair is a fault, never a reason to stamp TF_v1, an engine nobody chose.
 *
 * A POST call, never `{ get: true }`: the stamp writes, and a read-only call refuses it.
 */
async function stampOf(supabase: SupabaseClient, tournamentId: string): Promise<MatchRulesetStamp> {
  const { data: id, error } = await supabase.rpc('stamp_match_rules', {
    p_tournament_id: tournamentId,
  });
  // A failed call is not a Tournament with no ruleset: read as one, every bout generated was
  // stamped TF_v1, and a club formula Tournament was scored with it.
  if (error || typeof id !== 'string') {
    throw new Error(
      `The ruleset of Tournament ${tournamentId} was not read: ${error?.message ?? 'no copy'}`,
    );
  }
  const copy = await supabase
    .from('match_rules')
    .select('ruleset_code, ruleset_version, ruleset_content_hash')
    .eq('id', id)
    .maybeSingle();
  if (copy.error) {
    throw new Error(
      `The copy of Tournament ${tournamentId}'s rules was not read: ${copy.error.message}`,
    );
  }
  const row = copy.data as {
    ruleset_code?: unknown;
    ruleset_version?: unknown;
    ruleset_content_hash?: unknown;
  } | null;
  if (!row || typeof row.ruleset_code !== 'string' || row.ruleset_code.length === 0) {
    throw new Error('The Tournament has no ruleset pair to stamp on its bouts');
  }
  // The version as the copy holds it: its row builder wrote "1" as 1.0.0 (0229), and the column
  // is never empty.
  return {
    match_rules_id: id,
    ruleset_code: row.ruleset_code,
    ruleset_version: String(row.ruleset_version),
    ruleset_content_hash:
      typeof row.ruleset_content_hash === 'string' ? row.ruleset_content_hash : null,
  };
}

/** The rules a bout generated in this Tournament now is stamped with. */
export async function matchRulesetForTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<MatchRulesetStamp> {
  return stampOf(supabase, tournamentId);
}

/**
 * The bouts of a Tournament that have NOT started take its rules of now (operator, 2026-10-11;
 * a bout keeps everything it started under, 2026-10-17). A bout that started, or is finished,
 * keeps the copy it was fought under.
 *
 * Every door that changes a Tournament's rules calls this after its write. It can be called
 * again: the database writes no bout that already holds the copy, so a save that changes nothing
 * for the bouts writes none of them (each write is a change notice, and a new `updated_at` a
 * league reads as "results changed").
 *
 * The race is a bout that starts while this runs. "Not started" is asked in the database's own
 * write (`status = 'scheduled'`), so a bout the SERVER has as started is never moved. A bout
 * started on a tablet with no network is still `scheduled` here: it is moved, and its hits are
 * scored with the new rules when they arrive. The server cannot know better. A Tournament gone
 * meanwhile has no bouts to move; any other failure is an error.
 */
export async function restampUnstartedMatches(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<void> {
  const { error } = await supabase.rpc('stamp_match_rules', { p_tournament_id: tournamentId });
  if (error && error.code !== NO_TOURNAMENT) {
    throw new Error(`The bouts of ${tournamentId} did not take its ruleset: ${error.message}`);
  }
}

/**
 * After a door wrote new bouts: they take the ruleset in force now (operator, 2026-10-16, R3).
 *
 * A door reads its stamp, then writes its bouts. A change of the Tournament's rules between the
 * two re-stamps the bouts not started, and the new ones are not there yet: they kept the old
 * ruleset. Asked again after the write, either this re-stamp or the change's own runs after both
 * writes, so no new bout keeps the old one. Best effort: the bouts are written, and a re-stamp
 * that fails is logged, never thrown.
 *
 * A door that puts a bout back to "not started" (a reset, a bracket revert, a forfeit taken back)
 * has the same race: it reads the copy of now, then writes it. A change between the two re-stamps
 * the bouts not started while this one is still finished, so it lands on the older copy. It asks
 * again by the bout (`matchId`) after its write.
 */
export async function restampAfterInsert(
  supabase: SupabaseClient,
  where: { tournamentId: string } | { phaseId: string } | { matchId: string },
  logger: { warn: (message: string) => void },
): Promise<void> {
  try {
    await restampUnstartedMatches(supabase, await tournamentIdOf(supabase, where));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`New bouts were not re-stamped with the ruleset in force: ${reason}`);
  }
}

async function tournamentIdOf(
  supabase: SupabaseClient,
  where: { tournamentId: string } | { phaseId: string } | { matchId: string },
): Promise<string> {
  if ('tournamentId' in where) return where.tournamentId;
  if ('matchId' in where) return tournamentOfBout(supabase, where.matchId);
  const { data, error } = await supabase
    .from('phases')
    .select('tournament_id')
    .eq('id', where.phaseId)
    .maybeSingle();
  if (error) throw new Error(`Phase ${where.phaseId} was not read: ${error.message}`);
  if (!data) throw new Error(`Phase ${where.phaseId} was not found`);
  return (data as { tournament_id: string }).tournament_id;
}

/**
 * The rules a bout takes when it goes BACK to "not started" (a reset, a bracket revert, a forfeit
 * taken back): its Tournament's of now. Without it a bout finished before a re-pin, then reset,
 * was fought again under the old ruleset. The stamp also points the Tournament's other bouts not
 * started at the same copy, which they hold already or should: harmless before a refusal.
 *
 * Read before the door writes anything. A read that fails is an error.
 */
export async function matchRulesetForBout(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchRulesetStamp> {
  return stampOf(supabase, await tournamentOfBout(supabase, matchId));
}

/** The Tournament a bout is in, through its phase. A read that fails is an error. */
export async function tournamentOfBout(supabase: SupabaseClient, matchId: string): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .select('phases(tournament_id)')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`The ruleset of bout ${matchId} was not read: ${error.message}`);
  const phase = (data as { phases?: unknown } | null)?.phases;
  const tournamentId = (
    (Array.isArray(phase) ? phase[0] : phase) as { tournament_id?: unknown } | null
  )?.tournament_id;
  if (typeof tournamentId !== 'string') {
    throw new Error(`The ruleset of bout ${matchId} was not read: no Tournament`);
  }
  return tournamentId;
}

/** Same, for a bout generated in this phase. */
export async function matchRulesetForPhase(
  supabase: SupabaseClient,
  phaseId: string,
): Promise<MatchRulesetStamp> {
  const { data, error } = await supabase
    .from('phases')
    .select('tournament_id')
    .eq('id', phaseId)
    .maybeSingle();
  if (error) throw new Error(`The ruleset of phase ${phaseId} was not read: ${error.message}`);
  const tournamentId = (data as { tournament_id?: unknown } | null)?.tournament_id;
  if (typeof tournamentId !== 'string') {
    throw new Error(`The ruleset of phase ${phaseId} was not read: no Tournament`);
  }
  return stampOf(supabase, tournamentId);
}
