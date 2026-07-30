import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from './migration-schema';

/**
 * The replay is the foundation two other tests stand on
 * (`db-schema-conformance.test.ts` and `modules/privacy/subject-export.schema.test.ts`),
 * and both of them only ever ask it "does this column exist?". A replay that
 * silently LOST a column answers "no" — and reports a healthy query as a bug.
 *
 * That is not hypothetical: it happened while this was being written. Three
 * tables lost a column to comment handling, and every query naming one looked
 * like a violation.
 */

const schema = buildMigrationSchema();

describe('migration replay', () => {
  it('applies CREATE TABLE, DROP COLUMN and RENAME TO in migration order', () => {
    expect(schema.columns.get('matches')).toContain('phase_id');
    expect(schema.columns.get('events')).toContain('slug');
    // Dropped by 0063. If it comes back, the DROP replay is broken.
    expect(schema.columns.get('referee_assignments')).not.toContain('user_id');
    // 0023 renamed `fighters` to `global_persons`; the old name must retire, or
    // a query against a table that no longer exists reads as fine.
    expect(schema.columns.has('fighters')).toBe(false);
    expect(schema.columns.get('global_persons')).toContain('claimed_by_user_id');
    // 0001 named it `location`; a later migration renamed it to `city`.
    expect(schema.columns.get('events')).toContain('city');
    expect(schema.columns.get('events')).not.toContain('location');
  });

  /**
   * A column DOCUMENTED by a comment containing commas or braces is still a
   * column. The parser used to split the CREATE TABLE body on commas before
   * stripping comments, so
   *
   *   -- { groupNumber, refNumber, shortName, description, sanctions, sortOrder }
   *   entries JSONB NOT NULL DEFAULT '[]'::jsonb,
   *
   * left `entries` glued to the comment's tail and recorded `sortorder`
   * instead. These three are the real instances in the migration set — one per
   * distinct comment shape — so they pin the fix rather than restate it.
   */
  it('does not let a comma inside a column comment swallow the column', () => {
    expect(schema.columns.get('penalty_ruleset_versions')).toContain('entries');
    expect(schema.columns.get('hema_ratings_snapshots')).toContain('fighters');
    expect(schema.columns.get('tournament_ruleset_repins')).toContain('bucket_diff');
    expect(schema.columns.get('tournament_ruleset_repins')).toContain('placings_before');
    // …and the comment's own words are NOT columns.
    expect(schema.columns.get('penalty_ruleset_versions')).not.toContain('sortorder');
  });

  it('records views without columns, so callers can treat them as opaque', () => {
    expect(schema.views.size).toBeGreaterThan(0);
    for (const view of schema.views) expect(view).toBe(normaliseTable(view));
  });

  it('replayed a whole schema, not a handful of tables', () => {
    // 117 tables carry a CREATE TABLE today; views are counted separately, so
    // this is lower than the ~124 distinct names the API's `.from()` literals
    // mention. A replay that collapsed to a handful would make both consumers
    // vacuous without failing anything else.
    expect(schema.columns.size).toBeGreaterThanOrEqual(110);
  });
});
