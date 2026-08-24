import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_SCORING_CONFIG, FALLBACK_FFAMHE_2026 } from '@myclash/rules/results';

/**
 * The FFAMHE TF 2026 table exists TWICE: once as a row seeded into
 * `league_scoring_systems` by migration 0068, and once in `@myclash/rules` as
 * the fallback used when the registry row is missing and the league embedded no
 * points table. The code says it "mirrors the seed in migration 0068" — and a
 * comment is not a build failure.
 *
 * This reads the source of truth and the restatement and compares them, the
 * shape `scripts/check-docs-drift.mjs` uses.
 *
 * It lives in apps/api rather than beside the constant because `@myclash/rules`
 * has no `@types/node` and emits CommonJS: reading a file from a sibling package
 * is exactly the kind of reach that package exists to not have. apps/api already
 * depends on both halves, and `common/testing/migration-schema.ts` established
 * the candidate-path shape used below.
 */
const CANDIDATES = [
  path.resolve(process.cwd(), '../../packages/db/migrations'), // cwd = apps/api
  path.resolve(process.cwd(), 'packages/db/migrations'), // cwd = repo root
  path.resolve(__dirname, '../../../../../packages/db/migrations'),
];

const MIGRATION = (() => {
  for (const dir of CANDIDATES) {
    const file = path.join(dir, '0068_league_scoring_systems.sql');
    if (existsSync(file)) return file;
  }
  throw new Error(
    `0068_league_scoring_systems.sql not found in any of:\n  ${CANDIDATES.join('\n  ')}\nThis test compares against it; not finding it must fail rather than pass vacuously.`,
  );
})();

/**
 * The jsonb literal seeded for one column.
 *
 * `tie_breakers` appears twice — once as the column DEFAULT and once in the
 * seeded row — so this collapses on VALUE and insists exactly one survives.
 * The two agreeing with each other is a fact worth holding on its own.
 */
function seededJson(column: 'points_by_rank' | 'tie_breakers'): unknown {
  const sql = readFileSync(MIGRATION, 'utf8');
  const literals = [...sql.matchAll(/'(\[[^']*\]|\{[^']*\})'::jsonb/gu)].map(
    (match) => JSON.parse(match[1]!) as unknown,
  );
  if (literals.length === 0) {
    throw new Error(`${MIGRATION}: found no ::jsonb literals to compare against`);
  }

  const wanted = literals.filter((value) =>
    column === 'tie_breakers' ? Array.isArray(value) : value !== null && !Array.isArray(value),
  );
  const distinct = [...new Set(wanted.map((value) => JSON.stringify(value)))];
  if (distinct.length !== 1) {
    throw new Error(
      `${MIGRATION}: ${column} has ${distinct.length} different values in one migration (${distinct.join(' vs ')}) — the column default and the seeded row must agree`,
    );
  }
  return JSON.parse(distinct[0]!) as unknown;
}

describe('FFAMHE TF 2026 against its migration seed', () => {
  it('awards the same points for every one of the 16 ranks', () => {
    const seeded = seededJson('points_by_rank') as Record<string, number>;

    // Compare string-keyed, because that is what the jsonb column holds and what
    // `pointsForRank` would read back out of the registry.
    const local = Object.fromEntries(
      Object.entries(FALLBACK_FFAMHE_2026).map(([rank, points]) => [String(rank), points]),
    );

    expect(Object.keys(seeded)).toHaveLength(16);
    expect(local).toEqual(seeded);
  });

  it('defaults to the same tie-breaker chain the seed does', () => {
    expect(DEFAULT_LEAGUE_SCORING_CONFIG.tieBreakers).toEqual(seededJson('tie_breakers'));
  });
});
