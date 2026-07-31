import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Exchange, Ruleset, StandingsColumn } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';
import type { RulesetResolver } from '../matches/ruleset-resolver.service';
import type { StandingsMember } from '../pool-standings/compute-rows';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';
import { parseSwissConfig, type SwissConfig } from './dto/swiss-config.dto';

/**
 * Everything the Swiss standings read from the database.
 *
 * Split from SwissStandingsService so that file is the four ranking passes and
 * nothing else. Loading is a separate concern with its own traps — the embed
 * shapes, the ruleset resolution, and the exchange/forfeit inputs the shared
 * pool helper expects.
 */

export interface EntrantRow {
  registration_id: string;
  withdrawn_at_round: number | null;
  registrations: StandingsMember['registrations'];
}

export interface RoundRow {
  id: string;
  round_number: number;
  status: string;
  bye_registration_id: string | null;
}

export interface MatchRow {
  id: string;
  swiss_round_id: string | null;
  status: string;
  end_reason: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
}

export interface SwissLoadContext {
  tournamentId: string;
  phaseId: string;
  config: SwissConfig;
  entrants: EntrantRow[];
  rounds: RoundRow[];
  matches: MatchRow[];
}

export interface ResolvedRuleset {
  ruleset: Ruleset;
  code: string;
  version: string;
  columns: StandingsColumn[];
  afterblowMode: 'full' | 'deductive';
  runtimeConfig: unknown;
}

/** The Swiss phase and everything under it. Null when there is no Swiss phase. */
export async function loadSwissContext(
  supabase: SupabaseService,
  tournamentId: string,
): Promise<SwissLoadContext | null> {
  const { data: phase } = await supabase.service
    .from('phases')
    .select('id, config_json')
    .eq('tournament_id', tournamentId)
    .eq('type', 'swiss')
    .maybeSingle();
  const phaseRow = phase as { id: string; config_json: unknown } | null;
  if (!phaseRow) return null;

  const config = parseSwissConfig(phaseRow.config_json);
  if (!config) throw new BadRequestException(`Swiss phase ${phaseRow.id} has an invalid config`);

  const { data: entrantRows, error: entrantError } = await supabase.service
    .from('swiss_entrants')
    .select(
      'registration_id, withdrawn_at_round, ' +
        'registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation)))',
    )
    .eq('phase_id', phaseRow.id);
  if (entrantError) throw new BadRequestException(entrantError.message);

  const { data: roundRows, error: roundError } = await supabase.service
    .from('swiss_rounds')
    .select('id, round_number, status, bye_registration_id')
    .eq('phase_id', phaseRow.id)
    .order('round_number', { ascending: true });
  if (roundError) throw new BadRequestException(roundError.message);

  const { data: matchRows, error: matchError } = await supabase.service
    .from('matches')
    .select(
      'id, swiss_round_id, status, end_reason, red_registration_id, blue_registration_id, red_score, blue_score, winner_registration_id',
    )
    .eq('phase_id', phaseRow.id);
  if (matchError) throw new BadRequestException(matchError.message);

  return {
    tournamentId,
    phaseId: phaseRow.id,
    config,
    entrants: (entrantRows ?? []) as unknown as EntrantRow[],
    rounds: (roundRows ?? []) as unknown as RoundRow[],
    matches: (matchRows ?? []) as unknown as MatchRow[],
  };
}

/**
 * Exchanges and forfeit counts for the completed bouts.
 *
 * The same inputs the pool standings gather, in the same shapes, because they
 * feed the same shared helper.
 */
export async function loadScoringInputs(
  supabase: SupabaseService,
  matchIds: string[],
): Promise<{
  exchangesByMatch: Map<string, Exchange[]>;
  forfeitCountByReg: Map<string, number>;
}> {
  const exchangesByMatch = new Map<string, Exchange[]>();
  const forfeitCountByReg = new Map<string, number>();
  if (matchIds.length === 0) return { exchangesByMatch, forfeitCountByReg };

  const { data: exRows, error: exErr } = await supabase.service
    .from('exchanges')
    .select('match_id, type, first_striker_color, first_strike_value, afterblow_value, voided')
    .in('match_id', matchIds)
    .eq('voided', false);
  if (exErr) throw new BadRequestException(exErr.message);
  for (const r of (exRows ?? []) as Array<Record<string, unknown>>) {
    // computeAggregates reads only these fields; a minimal Exchange is enough.
    const ex = {
      type: r['type'],
      firstStrikerColor: r['first_striker_color'],
      firstStrikeValue: r['first_strike_value'],
      afterblowValue: r['afterblow_value'],
      voided: r['voided'],
    } as unknown as Exchange;
    const list = exchangesByMatch.get(r['match_id'] as string);
    if (list) list.push(ex);
    else exchangesByMatch.set(r['match_id'] as string, [ex]);
  }

  const { data: ffRows, error: ffErr } = await supabase.service
    .from('match_forfeits')
    .select('forfeiting_registration_id, match_id')
    .in('match_id', matchIds)
    .is('voided_at', null);
  if (ffErr) throw new BadRequestException(ffErr.message);
  for (const r of (ffRows ?? []) as Array<{ forfeiting_registration_id: string }>) {
    forfeitCountByReg.set(
      r.forfeiting_registration_id,
      (forfeitCountByReg.get(r.forfeiting_registration_id) ?? 0) + 1,
    );
  }
  return { exchangesByMatch, forfeitCountByReg };
}

/**
 * The tournament's ruleset, resolved the way the pool standings resolve it.
 *
 * Through RulesetResolver rather than the in-memory registry: the registry only
 * holds the built-ins, so an org-authored custom ruleset 400s here.
 * `normalizeRulesetVersion` stays because tournaments created before the
 * createTournament fix persisted the raw shorthand version.
 */
export async function resolveTournamentRuleset(
  supabase: SupabaseService,
  rulesets: RulesetResolver,
  tournamentId: string,
): Promise<ResolvedRuleset> {
  const { data, error } = await supabase.service
    .from('tournaments')
    .select('id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);

  const row = data as {
    ruleset_code: string;
    ruleset_version: string;
    ruleset_config?: Record<string, unknown> | null;
    scoring_config_json?: { afterblowMode?: unknown } | null;
  };
  const afterblowMode: 'full' | 'deductive' =
    row.scoring_config_json?.afterblowMode === 'deductive' ? 'deductive' : 'full';
  const ruleset = await rulesets.resolve(
    row.ruleset_code,
    normalizeRulesetVersion(row.ruleset_version),
  );
  if (!ruleset) {
    throw new BadRequestException(
      `Ruleset ${row.ruleset_code} v${row.ruleset_version} not registered`,
    );
  }
  return {
    ruleset,
    code: row.ruleset_code,
    version: row.ruleset_version,
    columns: ruleset.standingsColumns,
    afterblowMode,
    runtimeConfig: { ...(row.ruleset_config ?? {}), afterblowMode },
  };
}
