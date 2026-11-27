import { Logger } from '@nestjs/common';
import { formatInForce, parseMatchFormatConfig } from '@myclash/rulesets';
import type { MatchFormatConfig, Ruleset } from '@myclash/rulesets';
import type { RulesetResolver } from './ruleset-resolver.service';

const logger = new Logger('ScoredMatchFormat');

/**
 * The ruleset a bout is scored with: the one its pair names, and no other.
 *
 * Every door that sets a Tournament's pair refuses one that does not resolve,
 * and a bout's pair is copied from its Tournament's, so a pair that does not
 * resolve here is a fault, said in the log and answered as one. It used to be
 * scored with TF_v1: an engine nobody chose, deciding in silence. One owner:
 * the scorer and the route that tells the pad its rules read the same answer.
 */
export async function scoredRuleset(
  rulesets: RulesetResolver,
  code: string,
  version: string,
): Promise<Ruleset> {
  const ruleset = await rulesets.resolve(code, version);
  if (ruleset) return ruleset;
  logger.error(`Ruleset ${code}@${version} does not resolve; no bout is scored without it`);
  throw new Error(`The ruleset ${code}@${version} does not resolve`);
}

/**
 * The match format a ruleset actually plays under.
 *
 * The doubles ceiling lives on the SHARED match format, so a tournament can
 * carry one whatever its ruleset is — including `Generic_PointsCap`, which has
 * no such rule. Stripping it here means the round lifecycle agrees with the
 * ruleset: `evaluateRound` closes a round on max-doubles from this config, and
 * it is deliberately ruleset-blind, so the gate has to happen before it.
 *
 * `hasMaxDoubles === false` is the only case that strips. An older ruleset that
 * declares nothing keeps the ceiling, which is what every one of them did
 * before the capability existed.
 *
 * The scoring unit goes the same way: a ruleset that does not offer venues
 * (`hasVenues === false`, `Generic_PointsCap`) is forced to `'points'`, or the
 * round lifecycle would close best-of rounds on venues over a points score.
 *
 * The format is put in force (`formatInForce`: a venues bout counts up) only AFTER those strips:
 * a ruleset forced to points plays the direction its Tournament stores, as its engine does.
 */
export function scoredMatchFormat(config: unknown, ruleset: Ruleset): MatchFormatConfig {
  return formatInForce(editedMatchFormat(config, ruleset));
}

/**
 * The match format the settings screens edit: the ruleset's strips, and the direction the
 * Tournament STORES. Shown in force, a venues Tournament that stores a countdown would read
 * "count up", and once back in points a pick of "count up" would change nothing and send nothing.
 */
export function editedMatchFormat(config: unknown, ruleset: Ruleset): MatchFormatConfig {
  let matchFormat = parseMatchFormatConfig(
    (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
  );
  if (ruleset.metadata?.hasMaxDoubles === false) {
    matchFormat = { ...matchFormat, maxDoubleHits: null };
  }
  if (ruleset.metadata?.hasVenues === false) {
    matchFormat = { ...matchFormat, scoringUnit: 'points' };
  }
  return matchFormat;
}
