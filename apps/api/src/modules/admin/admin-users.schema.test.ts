import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from '../../common/testing/migration-schema';
import { DELETION_REFERENCE_CHECKS } from './admin-users.service';

/**
 * Does every column platform-account deletion reads still EXIST?
 *
 * This guard exists because the list it checks rotted in production and took
 * the whole feature down with it. Migration 0063 dropped
 * `referee_qualifications.user_id` — referee tables are keyed on `person_id`
 * now, reaching a login only through `global_persons.claimed_by_user_id`. The
 * deletion list kept naming `user_id`, PostgREST 400s a query that names an
 * unknown column, and `countReferences` turns that into a BadRequestException.
 *
 * The blast radius is what makes this worth a dedicated test: the check runs
 * unconditionally, before the safe/cleanup branch, so EVERY platform account
 * delete failed — including brand-new accounts attached to nothing at all. An
 * unknown column fails at PLAN time, before a single row is examined, so there
 * is no "empty account" path that skips it.
 *
 * Nothing else could catch it. `common/db-schema-conformance.test.ts` asks this
 * question of the whole API, but its scanner only matches LITERAL table names
 * (`FROM_LITERAL`), and this code passes table and column as variables —
 * `.from(check.table).select(check.column)`. And `admin-users.service.test.ts`
 * mocks Supabase, which returns rows for a dropped column exactly as happily as
 * for a live one. Only the migrations disagree, which is why this test reads
 * them instead of a mock.
 *
 * Same contract, and the same replay helper, as
 * `modules/privacy/subject-export.schema.test.ts`.
 */

const schema = buildMigrationSchema();

describe('platform account deletion column schema', () => {
  /**
   * The replay is the test. If it silently understood nothing, every assertion
   * below would pass on an empty world — so pin one column it must have found
   * and one it must have seen REMOVED.
   */
  it('replays migrations accurately enough to be trusted', () => {
    expect(schema.columns.get('global_persons')).toContain('claimed_by_user_id');
    expect(schema.columns.get('referee_qualifications')).toContain('person_id');
    // THE BUG, PINNED. Dropped by 0063. If this comes back, the DROP replay
    // broke and every other assertion here is worthless.
    expect(schema.columns.get('referee_qualifications')).not.toContain('user_id');
  });

  it('names no column the schema does not have', () => {
    const missing: string[] = [];
    for (const check of DELETION_REFERENCE_CHECKS) {
      const key = normaliseTable(check.table);
      const known = schema.columns.get(key);
      if (!known) {
        missing.push(`${check.table} (no CREATE TABLE in any migration)`);
        continue;
      }
      if (!known.has(check.column.toLowerCase())) missing.push(`${check.table}.${check.column}`);
    }
    expect(
      missing,
      'deletion reads a column that does not exist; PostgREST 400s the query and EVERY account delete fails',
    ).toEqual([]);
  });

  /**
   * The identity-type invariant. Cleanup compares its column to the auth uid
   * directly, so a non-`uid` entry marked for deletion would silently match
   * nothing — which is exactly how `workshop_enrollments.user_id` (a persons.id)
   * sat in the delete list doing nothing for months.
   */
  it('deletes only rows keyed by the auth uid', () => {
    const misTyped = DELETION_REFERENCE_CHECKS.filter(
      (check) => check.cleanup && check.reach !== 'uid',
    ).map((check) => `${check.table}.${check.column} (reach: ${check.reach})`);
    expect(
      misTyped,
      'a non-uid column cannot be compared to a uid: it would delete nothing, silently',
    ).toEqual([]);
  });

  /**
   * Event records outlive the login. The button promises it
   * ("Historical event facts remain" — admin.users.actions.confirmCleanupDelete),
   * and ErasureService keeps the same posture for GDPR erasure.
   */
  it('never deletes historical event facts', () => {
    const historical = [
      'workshop_enrollments',
      'referee_qualifications',
      'persons',
      'global_persons',
    ];
    for (const table of historical) {
      const check = DELETION_REFERENCE_CHECKS.find((entry) => entry.table === table);
      expect(check, `${table} must stay in the checked set`).toBeDefined();
      expect(check?.cleanup, `cleanup must not delete ${table} rows`).toBe(false);
    }
  });
});
