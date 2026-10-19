import { describe, expect, it } from 'vitest';
import { buildMigrationSchema } from '../../common/testing/migration-schema';
import { columnsFromSelect, embedsFromSelect } from '../../common/testing/supabase-select-parse';
import { LICE_MATCH_SELECT } from '../staff/lice-matches';
import { BOUT_RULES } from './bout-rules';
import { BOUT_COLUMNS } from './clock.service';
import { MATCH_ROW_SELECT, ROUND_CONTEXT_SELECT } from './scoring.service';

/**
 * Does every column the reads of a bout name still EXIST?
 *
 * Migration 0232 moved a bout's engine pair into its copy of its rules: `matches` lost
 * `ruleset_code`, `ruleset_version` and `ruleset_content_hash`, and `match_rules` holds them. A read
 * that still asks a bout for one of them is refused whole by PostgREST, and every service test
 * mocks Supabase, which answers a dropped column as happily as a live one.
 *
 * `common/db-schema-conformance.test.ts` asks this of every select written as a literal. These are
 * built from constants (`.select(MATCH_ROW_SELECT)`), which its scanner skips, so this test reads
 * them through the same parser, against the same replay of the migrations.
 */

const schema = buildMigrationSchema();

/** The reads of a bout built from a constant, each as the `matches` read it is. */
const BOUT_SELECTS = {
  MATCH_ROW_SELECT,
  ROUND_CONTEXT_SELECT,
  LICE_MATCH_SELECT,
  BOUT_COLUMNS,
};

/** The columns a select names that `table` does not have. Refuses a select that names none. */
function missingColumns(table: string, columns: string[], where: string): string[] {
  expect(columns, `${where} names no column on ${table}: the parser read nothing`).not.toEqual([]);
  const known = schema.columns.get(table);
  if (!known) return [`${table} (no CREATE TABLE in any migration) — ${where}`];
  return columns
    .filter((column) => !known.has(column))
    .map((column) => `${table}.${column} — ${where}`);
}

describe('the columns of a bout read', () => {
  /**
   * The replay is the test. If it silently understood nothing, every assertion below would pass on
   * an empty world — so pin the columns 0232 moved, on both sides of the move.
   */
  it('replays migrations accurately enough to be trusted', () => {
    expect(schema.columns.get('matches')).toContain('match_rules_id');
    expect(schema.columns.get('match_rules')).toContain('ruleset_code');
    expect(schema.columns.get('match_rules')).toContain('scoring_config_json');
    // Dropped by 0232. If this comes back, the DROP replay broke and every other assertion here is
    // worthless.
    expect(schema.columns.get('matches')).not.toContain('ruleset_code');
    expect(schema.columns.get('matches')).not.toContain('ruleset_version');
    expect(schema.columns.get('matches')).not.toContain('ruleset_content_hash');
  });

  it('asks a bout only for columns it has', () => {
    const missing = Object.entries(BOUT_SELECTS).flatMap(([name, select]) =>
      missingColumns('matches', columnsFromSelect(select, {}), name),
    );
    expect(
      missing,
      'a bout read names a column `matches` does not have; PostgREST 400s it and the bout is not scored',
    ).toEqual([]);
  });

  it("asks a bout's copy only for columns it has", () => {
    const copies = embedsFromSelect(BOUT_RULES, {}).filter(
      (embed) => embed.target === 'match_rules',
    );
    expect(copies, 'BOUT_RULES embeds the copy once').toHaveLength(1);
    expect(
      missingColumns('match_rules', copies[0]!.columns, 'BOUT_RULES'),
      "the copy's embed names a column `match_rules` does not have; every scoring read of a bout 400s",
    ).toEqual([]);
  });
});
