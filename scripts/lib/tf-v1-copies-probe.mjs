/**
 * Check 18 of the RLS probe (`scripts/db-rls-probe.mjs`): TF_v1's row holds none of the engine's
 * own values, and a value a platform admin set is kept (migration 0245, operator rulings 61, 135).
 *
 * (0) The replayed row's `tf_config` is empty: 0053's copies and 0072's match format are gone.
 * (a) Seeded again with what 0053 and 0072 wrote (stated here, not read from 0245's literal), the
 *     migration's own text, run again, empties it.
 * (b) Seeded with a value of its own on EVERY leaf the migration guards, "none" (null) included,
 *     beside keys it never touches, the text keeps the row as it is.
 * (c) Seeded with values of its own beside engine-equal ones, it drops only the engine's.
 * The migration is found by the tag of its literal, not its number. Each run is in a savepoint
 * rolled back, so nothing is left behind; a RAISE inside is reported, not thrown, and one case's
 * failure does not hide another's.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isolated } from './match-rules-probe-kit.mjs';
import { migrationLiteral, MIGRATIONS_DIR } from './migration-literal.mjs';

const ROW = `code = 'TF_v1' AND is_system`;

/** TF_v1's tf_config as 0053 wrote it, with 0072's match format, after 0235's strip. */
const COPIES = {
  winBonus: 3,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
  doublePenaltyFormula: 'n*(n-1)/3',
  matchFormat: {
    pointCap: 10,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 4,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
  },
};

/** A value of its own on every guarded leaf, and keys the migration never touches. */
const DELIBERATE = {
  winBonus: 4,
  targetValues: { deepTarget: 3, shallowTarget: 1 },
  doublePenaltyFormula: '0',
  targets: [
    { name: 'Deep', value: 2 },
    { name: 'Shallow', value: 1 },
    { name: 'Limb', value: 1 },
  ],
  matchFormat: {
    pointCap: 12,
    scoringDirection: 'reverse_zero_loses',
    timerMode: 'countup',
    timeLimitsSeconds: { pool: 120, bracket: null, finals: 60, swiss: 45 },
    softClockLimitSeconds: 0,
    maxDoubleHits: null,
    maxDoubleHitOutcome: 'result_stands',
    bestOf: { pool: 3 },
    levelAtTime: { pool: [{ kind: 'sudden_death' }] },
  },
};

/**
 * Values of its own beside engine-equal ones: only the engine's go. The engine's targets are among
 * them: 0053 never wrote any, but the editor before 0245 wrote them on every TF_v1 Save.
 */
const MIXED = {
  winBonus: 3,
  doublePenaltyFormula: '0',
  targets: [
    { name: 'Deep', value: 2 },
    { name: 'Shallow', value: 1 },
  ],
  matchFormat: {
    pointCap: 10,
    timerMode: 'countup',
    timeLimitsSeconds: { pool: 90, bracket: 120 },
  },
};
const MIXED_KEPT = {
  doublePenaltyFormula: '0',
  matchFormat: { timerMode: 'countup', timeLimitsSeconds: { bracket: 120 } },
};

const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

const tfConfig = async (q) =>
  (await q.unsafe(`SELECT tf_config FROM custom_rulesets WHERE ${ROW}`))[0]?.tf_config;

/** A failure sentence when the migration's text, run over `seed`, does not leave `expected`. */
async function rerun(tx, file, migration, [what, seed, expected]) {
  let after;
  try {
    await isolated(tx, async (sp) => {
      await sp.unsafe(`UPDATE custom_rulesets SET tf_config = $1::jsonb WHERE ${ROW}`, [seed]);
      await sp.unsafe(migration);
      after = await tfConfig(sp);
    });
  } catch (error) {
    return `check 18: ${file} could not run again over ${what}: ${error.message}`;
  }
  return same(after, expected)
    ? null
    : `check 18: ${file} turns ${what} into ${JSON.stringify(after)}`;
}

/** What is wrong, as sentences; none when all is right. */
export async function tfV1CopiesFailures(tx) {
  const failures = [];
  const replayed = await tfConfig(tx);
  if (replayed !== null && !same(replayed, {})) {
    failures.push(`check 18: TF_v1's tf_config holds ${JSON.stringify(replayed)} after the replay`);
  }
  let file;
  try {
    ({ file } = migrationLiteral('tf_v1_engine_copies'));
  } catch (error) {
    return [...failures, `check 18: ${error.message}`];
  }
  const migration = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const cases = [
    ['the copies of 0053 and 0072', COPIES, {}],
    ['a deliberate tf_config', DELIBERATE, DELIBERATE],
    ['deliberate values beside engine ones', MIXED, MIXED_KEPT],
  ];
  for (const each of cases) {
    const failure = await rerun(tx, file, migration, each);
    if (failure) failures.push(failure);
  }
  return failures;
}
