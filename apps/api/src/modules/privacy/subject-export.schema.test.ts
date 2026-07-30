import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from '../../common/testing/migration-schema';
import { SUBJECT_EXPORT_TABLES } from './subject-export.tables';

/**
 * Does every column the subject export reads still EXIST?
 *
 * `subject-export.coverage.test.ts` guards the other direction — that no table
 * is silently missing from the export. This one guards the columns, and it
 * exists because the gap between them shipped a dead endpoint:
 *
 *   Migration 0063 dropped `user_id` from `referee_assignments`,
 *   `referee_qualifications` and `event_referees` ("Post-0063: there is no
 *   user_id column on..." — its own header). SUBJECT_EXPORT_TABLES kept
 *   declaring it. `fetchDirect` correctly refuses to swallow a PostgREST error,
 *   so `GET /me/data-export.zip` returned 500 for EVERY user — a GDPR Art. 15
 *   endpoint, dead in production.
 *
 * Nothing caught it: the coverage test only checks table names, and
 * `subject-export.service.test.ts` mocks Supabase, so a column that no longer
 * exists is a column the mock happily returns rows for. Only the real database
 * disagrees — which is why this test reads the migrations instead of a mock.
 *
 * The migration replay itself now lives in `common/testing/migration-schema.ts`,
 * shared with `common/db-schema-conformance.test.ts`, which asks the same
 * question of EVERY query in the API rather than just this map.
 */

const schema = buildMigrationSchema();

describe('subject export column schema', () => {
  /**
   * The parser is the test. If it silently understood nothing, every assertion
   * below would pass on an empty world — so pin one column it must have found
   * and one it must have seen REMOVED.
   */
  it('replays migrations accurately enough to be trusted', () => {
    expect(schema.columns.get('matches')).toContain('phase_id');
    expect(schema.columns.get('events')).toContain('slug');
    // Dropped by 0063. If this comes back, the DROP replay broke and every
    // other assertion here is worthless.
    expect(schema.columns.get('referee_assignments')).not.toContain('user_id');
    // Renamed to global_persons by 0023 — the rename replay must retire the old
    // name, or a map entry pointing at a table that no longer exists reads as
    // fine (which is exactly how the export stayed broken).
    expect(schema.columns.has('fighters')).toBe(false);
    expect(schema.columns.get('global_persons')).toContain('claimed_by_user_id');
  });

  it('declares no column that the schema does not have', () => {
    const missing: string[] = [];
    for (const [table, spec] of Object.entries(SUBJECT_EXPORT_TABLES)) {
      const key = normaliseTable(table);
      if (schema.views.has(key)) continue;
      const known = schema.columns.get(key);
      if (!known) {
        missing.push(`${table} (no CREATE TABLE in any migration)`);
        continue;
      }
      for (const { column } of spec.reaches) {
        if (!known.has(column.toLowerCase())) missing.push(`${table}.${column}`);
      }
    }
    expect(
      missing,
      'SUBJECT_EXPORT_TABLES reads columns that no longer exist; the export 500s on every one of them',
    ).toEqual([]);
  });
});
