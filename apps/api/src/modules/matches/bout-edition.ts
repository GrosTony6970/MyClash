import type { Logger } from '@nestjs/common';
import type { DecisionEdition } from '@myclash/rulesets';
import { normalizeRulesetVersion } from '../events/ruleset-row-projection';
import type { RulesetResolver } from './ruleset-resolver.service';

/**
 * A bout row as the scoring pad reads it, with the end-decision edition of the
 * bout's OWN ruleset version (`decision_edition`): the pad decides an End, a
 * round and the winner at the cap with no network, and must decide as the
 * server will. The edition comes from the object the scorer uses (the
 * resolver, and its 5-second cache).
 *
 * The one owner for both routes a bout reaches the pad by: `GET /matches/:id`
 * and the read of a whole piste. A read that fails, or a pair that does not
 * resolve, leaves the field out and is logged: a bout read never turns into a
 * server error over it, since the pad does not open a bout on a 5xx. The pad
 * then decides with today's edition and says so.
 */
export async function withDecisionEdition(
  row: Record<string, unknown>,
  rulesets: RulesetResolver | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<Record<string, unknown> & { decision_edition?: DecisionEdition }> {
  if (!rulesets) {
    logger.warn(`Bout ${String(row['id'])}: no ruleset resolver wired; no edition sent`);
    return row;
  }
  const code = String(row['ruleset_code']);
  const version = normalizeRulesetVersion(String(row['ruleset_version']));
  try {
    const ruleset = await rulesets.resolve(code, version);
    if (ruleset) return { ...row, decision_edition: ruleset.decisionEdition };
    logger.warn(`Bout ${String(row['id'])}: ${code}@${version} does not resolve; no edition sent`);
  } catch (err) {
    logger.warn(
      `Bout ${String(row['id'])}: the edition of ${code}@${version} was not read: ${String(err)}`,
    );
  }
  return row;
}
