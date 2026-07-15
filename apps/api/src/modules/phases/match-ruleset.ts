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
}

const FALLBACK: MatchRulesetStamp = { ruleset_code: 'TF_v1', ruleset_version: '1.0.0' };

function toStamp(row: unknown): MatchRulesetStamp {
  const r = row as { ruleset_code?: unknown; ruleset_version?: unknown } | null;
  if (!r || typeof r.ruleset_code !== 'string' || r.ruleset_code.length === 0) return FALLBACK;
  return {
    ruleset_code: r.ruleset_code,
    ruleset_version: normalizeRulesetVersion(
      typeof r.ruleset_version === 'string' && r.ruleset_version.length > 0
        ? r.ruleset_version
        : '1',
    ),
  };
}

/** Tournament's ruleset pair (version normalized, e.g. "1" → "1.0.0"). */
export async function matchRulesetForTournament(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<MatchRulesetStamp> {
  const { data } = await supabase
    .from('tournaments')
    .select('ruleset_code, ruleset_version')
    .eq('id', tournamentId)
    .maybeSingle();
  return toStamp(data);
}

/** Same, resolved via the phase's parent tournament. */
export async function matchRulesetForPhase(
  supabase: SupabaseClient,
  phaseId: string,
): Promise<MatchRulesetStamp> {
  const { data } = await supabase
    .from('phases')
    .select('tournaments(ruleset_code, ruleset_version)')
    .eq('id', phaseId)
    .maybeSingle();
  const embed = (data as { tournaments?: unknown } | null)?.tournaments;
  // Many-to-one embeds are objects; normalize defensively (embed-flip gotcha).
  return toStamp(Array.isArray(embed) ? embed[0] : embed);
}
