/**
 * Check 14 of the RLS probe (`scripts/db-rls-probe.mjs`): the built-in penalty ruleset holds the
 * FFAMHE forfeit rules (migration 0235, operator rulings 63-76).
 *
 * STRUCTURAL, in SQL alone: the replay job builds no package, so no `@myclash/*` schema can be
 * loaded here. The row's own keys have the JSON types the API's schema needs, and the row equals,
 * as jsonb, the literal the migration wrote it with, read from the migration file by the same
 * extractor as the API's parity test. A read, so it leaves nothing behind.
 */

import { migrationLiteral } from './migration-literal.mjs';

const TYPES = {
  reasons: 'object',
  disqualifyAfter: 'number',
  disqualifyBeforeFirstBout: 'boolean',
  blackCardOpponentScore: 'number',
};

/** What is wrong, as sentences; none when all is right. */
export async function forfeitRulesFailures(tx) {
  const { file, value } = migrationLiteral('ffamhe_forfeit_rules');
  const rows = await tx.unsafe(
    `SELECT jsonb_typeof(forfeit_rules->'reasons') AS reasons,
            jsonb_typeof(forfeit_rules->'disqualifyAfter') AS "disqualifyAfter",
            jsonb_typeof(forfeit_rules->'disqualifyBeforeFirstBout') AS "disqualifyBeforeFirstBout",
            jsonb_typeof(forfeit_rules->'blackCardOpponentScore') AS "blackCardOpponentScore",
            forfeit_rules = $1::jsonb AS same
       FROM penalty_rulesets
      WHERE built_in AND owner_organization_id IS NULL`,
    // The value itself: the driver writes a jsonb parameter as JSON (a string would be one).
    [value],
  );
  if (rows.length !== 1) {
    return [`check 14: ${rows.length} built-in penalty rulesets, not 1`];
  }
  const [row] = rows;
  const failures = Object.entries(TYPES)
    .filter(([key, type]) => row[key] !== type)
    .map(
      ([key, type]) =>
        `check 14: the built-in's forfeit rules hold ${key} as ${row[key]}, not ${type}`,
    );
  if (!row.same) failures.push(`check 14: the built-in's forfeit rules are not those of ${file}`);
  return failures;
}
