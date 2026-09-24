import { NotFoundException } from '@nestjs/common';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import {
  isHiddenCompetition,
  isInsider,
  type CompetitionEvent,
  type PublicReader,
} from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

const MATCH_CONFIG_SELECT =
  'ruleset_code, ruleset_config, scoring_config_json, lock_config_json, status, events!inner(id, status, organization_id, event_kind)';

interface MatchConfigRow {
  ruleset_code: string;
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
 */
export async function readMatchConfig(
  deps: EventAuthzDeps,
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
  const hidden =
    row !== null && isHiddenCompetition({ tournamentStatus: row.status, event: row.events });
  if (!row || (hidden && !(await isInsider(deps, row.events, reader)))) {
    throw new NotFoundException(`Tournament ${tournamentId} not found`);
  }

  const rulesetConfig = validateTournamentRulesetConfig(row.ruleset_code, row.ruleset_config ?? {});
  const scoringConfig = normalizeTournamentScoringConfig(
    row.scoring_config_json ?? DEFAULT_SCORING_CONFIG,
  );
  return {
    rulesetConfig,
    matchFormat: rulesetConfig.matchFormat,
    scoringConfig,
    display: scoringConfig.display,
    lockConfig: normalizeTournamentLockConfig(row.lock_config_json),
  };
}
