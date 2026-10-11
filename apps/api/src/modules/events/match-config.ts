import { NotFoundException } from '@nestjs/common';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import {
  hiddenFromReader,
  type CompetitionEvent,
  type PublicReader,
} from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import type { RulesetResolver } from '../matches/ruleset-resolver.service';
import { scoredMatchFormat, scoredRuleset } from '../matches/scored-match-format';
import { normalizeRulesetVersion } from './ruleset-defaults';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

const MATCH_CONFIG_SELECT =
  'ruleset_code, ruleset_version, ruleset_config, scoring_config_json, lock_config_json, status, events!inner(id, status, organization_id, event_kind)';

interface MatchConfigRow {
  ruleset_code: string;
  ruleset_version: string | null;
  ruleset_config: unknown;
  scoring_config_json: unknown;
  lock_config_json: unknown;
  status: string;
  events: CompetitionEvent;
}

/**
 * The rules the referee's pad draws: `GET tournaments/:id/match-config`.
 *
 * An unknown id is a 404, and a Tournament hidden from the caller answers the
 * same 404 (rulings 81-83, 95). It used to answer both with the TF_v1
 * defaults, and a failed read too: the pad stored those as fresh and scored with
 * the wrong buttons. A failed read is now a 5xx: a pad that stored the rules
 * keeps them and says they are not confirmed.
 *
 * The match format is built by the scorer's own functions, not read as the row
 * stores it: a ruleset with no doubles rule has no doubles limit. The pad shows
 * that limit, and with no network closes a round on it.
 *
 * It is the format of a bout not yet started. The scorer reads the pair stamped
 * on each bout, and a change of the Tournament's ruleset moves only the bouts
 * that have not started (`restampUnstartedMatches`): for a bout started before
 * an audited re-pin, this answer and the scorer can differ.
 */
export async function readMatchConfig(
  deps: EventAuthzDeps & { rulesets: RulesetResolver },
  tournamentId: string,
  reader: PublicReader,
) {
  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select(MATCH_CONFIG_SELECT)
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw new Error(`match-config read failed: ${error.message}`);
  const row = data as MatchConfigRow | null;
  const unknown = new NotFoundException(`Tournament ${tournamentId} not found`);
  if (!row) throw unknown;
  if (await hiddenFromReader(deps, { tournamentStatus: row.status, event: row.events }, reader)) {
    throw unknown;
  }

  // First: a stored config the schema refuses is a 400 here, in its own words.
  const stored = validateTournamentRulesetConfig(row.ruleset_code, row.ruleset_config ?? {});
  // The pair a bout generated now is stamped with (`matchRulesetForTournament`).
  const ruleset = await scoredRuleset(
    deps.rulesets,
    row.ruleset_code,
    normalizeRulesetVersion(row.ruleset_version || '1'),
  );
  const matchFormat = scoredMatchFormat(row.ruleset_config, ruleset);
  const rulesetConfig = { ...stored, matchFormat };
  const scoringConfig = normalizeTournamentScoringConfig(
    row.scoring_config_json ?? DEFAULT_SCORING_CONFIG,
  );
  return {
    rulesetConfig,
    matchFormat,
    scoringConfig,
    display: scoringConfig.display,
    lockConfig: normalizeTournamentLockConfig(row.lock_config_json),
  };
}
