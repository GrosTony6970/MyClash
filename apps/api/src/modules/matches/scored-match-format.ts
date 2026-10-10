import { Logger } from '@nestjs/common';
import { TF_v1, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { MatchFormatConfig, Ruleset } from '@myclash/rulesets';
import type { RulesetResolver } from './ruleset-resolver.service';

const logger = new Logger('ScoredMatchFormat');

/**
 * The ruleset a bout is scored with.
 *
 * A pair the resolver cannot read (an unknown code, a custom ruleset never
 * published) is scored with TF_v1. One owner: the scorer and the route that
 * tells the pad its rules must agree on that fallback, or the pad shows rules
 * the server does not apply.
 */
export async function scoredRuleset(
  rulesets: RulesetResolver,
  code: string,
  version: string,
): Promise<Ruleset> {
  const ruleset = await rulesets.resolve(code, version);
  if (ruleset) return ruleset;
  logger.warn(`Ruleset ${code}@${version} not found, falling back to TF_v1`);
  return TF_v1;
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
 */
export function scoredMatchFormat(config: unknown, ruleset: Ruleset): MatchFormatConfig {
  const matchFormat = normalizeMatchFormatConfig(
    (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
  );
  if (ruleset.metadata?.hasMaxDoubles === false) {
    return { ...matchFormat, maxDoubleHits: null };
  }
  return matchFormat;
}
