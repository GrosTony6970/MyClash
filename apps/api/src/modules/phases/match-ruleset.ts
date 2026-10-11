import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';

/**
 * The ruleset pair stamped onto every generated `matches` row.
 *
 * Match generation used to hardcode `TF_v1`/`1.0.0` at every insert site,
 * so non-TF tournaments (Generic_PointsCap, org custom formulas) had their
 * matches SCORED with the wrong engine while standings were computed from
 * the tournament's real ruleset — two engines for the same data.
 */
export interface MatchRulesetStamp {
  ruleset_code: string;
  ruleset_version: string;
  /** The tournament's effective (scoring, penalty) content hash in force when
   *  the bout was stamped: at generation, and again at each change of the
   *  Tournament's rules while the bout has not started. Frozen from its start,
   *  so a scored bout records which behaviour produced it. Null until the
   *  tournament has been stamped. */
  ruleset_content_hash: string | null;
}

const FALLBACK: MatchRulesetStamp = {
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_content_hash: null,
};

function toStamp(row: unknown): MatchRulesetStamp {
  const r = row as {
    ruleset_code?: unknown;
    ruleset_version?: unknown;
    ruleset_content_hash?: unknown;
  } | null;
  if (!r || typeof r.ruleset_code !== 'string' || r.ruleset_code.length === 0) return FALLBACK;
  return {
    ruleset_code: r.ruleset_code,
    ruleset_version: normalizeRulesetVersion(
      typeof r.ruleset_version === 'string' && r.ruleset_version.length > 0
        ? r.ruleset_version
        : '1',
    ),
    ruleset_content_hash:
      typeof r.ruleset_content_hash === 'string' ? r.ruleset_content_hash : null,
  };
}

/** Tournament's ruleset pair (version normalized, e.g. "1" → "1.0.0"). */
export async function matchRulesetForTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<MatchRulesetStamp> {
  const { data } = await supabase
    .from('tournaments')
    .select('ruleset_code, ruleset_version, ruleset_content_hash')
    .eq('id', tournamentId)
    .maybeSingle();
  return toStamp(data);
}

/**
 * The bouts of a Tournament that have NOT started take its ruleset pair and
 * its hash (operator, 2026-10-11). A bout that started, or is finished, keeps
 * the pair it was fought under.
 *
 * A bout is scored with the pair stamped on ITS row, and the Pool table is
 * computed with the Tournament's. Nothing stamped a bout again: Pools made
 * under one ruleset, then a Tournament switched to another before the first
 * bout, gave bouts scored by the old engine under a table of the new one.
 *
 * Every door that changes a Tournament's ruleset calls this after its write.
 * It can be called again: a second call writes the same pair.
 *
 * The race is a bout that starts while this runs. "Not started" is asked in
 * the write itself (`status = 'scheduled'`), so a bout the SERVER has as
 * started is never moved; it keeps the old pair. A bout started on a tablet
 * with no network is still `scheduled` here: it is moved, and its hits are
 * scored with the new pair when they arrive. The server cannot know better.
 *
 * A read that fails is an error, never "no Tournament": the fallback of
 * `toStamp` would put every bout on TF_v1.
 */
export async function restampUnstartedMatches(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<void> {
  const tournament = await supabase
    .from('tournaments')
    .select('ruleset_code, ruleset_version, ruleset_content_hash')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournament.error) {
    throw new Error(`Tournament ${tournamentId} was not read: ${tournament.error.message}`);
  }
  if (!tournament.data) return;

  const phases = await supabase.from('phases').select('id').eq('tournament_id', tournamentId);
  if (phases.error) {
    throw new Error(`The phases of ${tournamentId} were not read: ${phases.error.message}`);
  }
  const phaseIds = ((phases.data ?? []) as Array<{ id: string }>).map((phase) => phase.id);
  if (phaseIds.length === 0) return;

  const { error } = await supabase
    .from('matches')
    .update(toStamp(tournament.data))
    .in('phase_id', phaseIds)
    .eq('status', 'scheduled');
  if (error) {
    throw new Error(`The bouts of ${tournamentId} did not take its ruleset: ${error.message}`);
  }
}

/**
 * The pair a bout takes when it goes BACK to "not started" (a reset, a bracket
 * revert, a forfeit taken back): its Tournament's pair of now. Without it a
 * bout finished before a re-pin, then reset, was fought again under the old
 * ruleset.
 *
 * Read before the door writes anything. A read that fails is an error: the
 * fallback of `toStamp` would put the bout on TF_v1.
 */
export async function matchRulesetForBout(
  supabase: SupabaseClient,
  matchId: string,
): Promise<MatchRulesetStamp> {
  const { data, error } = await supabase
    .from('matches')
    .select('phases(tournaments(ruleset_code, ruleset_version, ruleset_content_hash))')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`The ruleset of bout ${matchId} was not read: ${error.message}`);
  const phase = (data as { phases?: unknown } | null)?.phases;
  const embed = ((Array.isArray(phase) ? phase[0] : phase) as { tournaments?: unknown } | null)
    ?.tournaments;
  if (!embed) throw new Error(`The ruleset of bout ${matchId} was not read: no Tournament`);
  return toStamp(Array.isArray(embed) ? embed[0] : embed);
}

/** Same, resolved via the phase's parent tournament. */
export async function matchRulesetForPhase(
  supabase: SupabaseClient,
  phaseId: string,
): Promise<MatchRulesetStamp> {
  const { data } = await supabase
    .from('phases')
    .select('tournaments(ruleset_code, ruleset_version, ruleset_content_hash)')
    .eq('id', phaseId)
    .maybeSingle();
  const embed = (data as { tournaments?: unknown } | null)?.tournaments;
  // Many-to-one embeds are objects; normalize defensively (embed-flip gotcha).
  return toStamp(Array.isArray(embed) ? embed[0] : embed);
}
