import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Ruleset, TFv1Config } from '@myclash/rulesets';
import type { EffectiveRules, EffectiveTfRules, RulesStart } from '@myclash/types';
import { isCodedRuleset } from '@myclash/types/effective-rules';
import { forfeitAsksOf } from '@myclash/types/forfeit-rules';
import {
  hiddenFromReader,
  type CompetitionEvent,
  type PublicReader,
} from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import type { RulesetResolver } from '../matches/ruleset-resolver.service';
import { scoredMatchFormat, scoredRuleset } from '../matches/scored-match-format';
import { cardAndForfeitRules } from '../penalties/forfeit-rules-in-force';
import { pairOf } from './audited-rules-write';
import { normalizeRulesetVersion } from './ruleset-defaults';
import type { RulesSeed } from './ruleset-move-config';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

const logger = new Logger('EffectiveRules');

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
 * an audited re-pin, this answer and the scorer can differ. So can it for a bout
 * started on a tablet with no network, which its Start puts back on the copy the
 * tablet showed (`startCopyOf`).
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
  // A NULL column reads as every missing value does (the normalizer's own fill).
  const scoringConfig = normalizeTournamentScoringConfig(row.scoring_config_json);
  return {
    rulesetConfig,
    matchFormat,
    scoringConfig,
    display: scoringConfig.display,
    lockConfig: normalizeTournamentLockConfig(row.lock_config_json),
    forfeitAsks: await forfeitAsksFor(deps, tournamentId),
  };
}

/**
 * Which forfeit reasons ask "can the Fighter continue?" (ruling 76), and none of the rules
 * themselves. Contained: rules that cannot be read or do not parse answer null and a log line,
 * and the pad asks, with a note that the rules are not confirmed.
 */
function forfeitAsksFor(deps: EventAuthzDeps, tournamentId: string) {
  return contained({ id: tournamentId }, 'the forfeit questions', async () => {
    const { forfeitRules } = await cardAndForfeitRules(deps.supabase.service, tournamentId);
    return forfeitAsksOf(forfeitRules);
  });
}

/** A Tournament row as `GET /tournaments/:id` answers it (`getTournamentById`). */
type TournamentRow = Record<string, unknown>;

/** Settings and a scoring config as the engine applies them, on the pair `ruleset` scores. */
function rulesOf(
  row: TournamentRow,
  settings: unknown,
  scoring: unknown,
  ruleset: Ruleset,
): RulesStart {
  const { code } = pairOf(row);
  const parsed = validateTournamentRulesetConfig(code, settings ?? {});
  // The base code a fork reuses, as `getTournamentById` answers it (null for any other ruleset).
  const baseCode = row['ruleset_base_code'];
  const coded = isCodedRuleset(code, typeof baseCode === 'string' ? baseCode : null);
  return {
    matchFormat: scoredMatchFormat(settings, ruleset),
    // A coded ruleset is parsed by TF_v1's schema (`validateTournamentRulesetConfig`).
    tf: coded ? tfRulesOf(parsed as TFv1Config) : null,
    scoring: normalizeTournamentScoringConfig(scoring),
  };
}

/** Exactly what the screens show of TF_v1's own settings, nothing a reader does not apply. */
function tfRulesOf(parsed: TFv1Config): EffectiveTfRules {
  return { winBonus: parsed.winBonus, targetValues: { ...parsed.targetValues } };
}

/**
 * `read`'s answer, or null and a log line naming the Tournament when it cannot be answered. The
 * engine refusing a stored config is the row's fault: a warning. Anything else (a read that
 * failed, a fault in this code) is an error with its stack, so it cannot pass for a refused row.
 */
async function contained<T>(row: TournamentRow, what: string, read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const line = `Tournament ${String(row['id'])}: ${what} not answered: ${reason}`;
    if (error instanceof HttpException) logger.warn(line);
    else logger.error(line, error instanceof Error ? error.stack : undefined);
    return null;
  }
}

/**
 * The Tournament row with the rules it plays under, as its settings screens show them: the ONE
 * owner of the value in force (operator ruling 46). Built by the engine's own functions from the
 * stored columns, so a setting the row lacks shows the engine's value, and `start` is what the
 * pair seeds a new Tournament with at the pinned version (ruling 51), for the badge and Reset.
 *
 * Contained: a stored config the engine refuses, or a pair that does not resolve, answers
 * `effectiveRules: null` and a log line; the raw row still loads, so Basics can move the pair and
 * repair it. A seed that cannot be read or is refused answers `start: null` the same way.
 */
export async function withEffectiveRules<T extends TournamentRow>(
  deps: { rulesets: RulesetResolver },
  row: T,
  seedOf: () => Promise<RulesSeed>,
): Promise<T & { effectiveRules: EffectiveRules | null }> {
  const effectiveRules = await contained(row, 'the rules in force', async () => {
    const { code, version } = pairOf(row);
    const ruleset = await scoredRuleset(deps.rulesets, code, version);
    const own = rulesOf(row, row['ruleset_config'], row['scoring_config_json'], ruleset);
    const start = await contained(row, 'the rules it starts from', async () => {
      const seed = await seedOf();
      return rulesOf(row, seed.config, seed.scoring, ruleset);
    });
    return { ...own, lock: normalizeTournamentLockConfig(row['lock_config_json']), start };
  });
  return { ...row, effectiveRules };
}
