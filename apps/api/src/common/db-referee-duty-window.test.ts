import { describe, expect, it } from 'vitest';
import { buildMigrationSchema } from './testing/migration-schema';

/**
 * A referee duty stores no time of its own (ADR-017, migration 0198).
 *
 * The board used to write `starts_at` / `ends_at` onto each duty when the
 * organiser saved, and nothing updated them afterwards, so they went stale the
 * moment a bout moved. Every reader now works a duty's window out from the
 * Matches it covers. This holds the drop against a later migration adding the
 * copy back.
 *
 * Read on the REPLAYED schema, table by table: Workshop sessions carry columns
 * of the same names and keep them, so a name search over the SQL would pass for
 * the wrong table. It cannot see the running database; `pnpm
 * db:migrations:replay` and a read of `information_schema.columns` cover that.
 */
describe('referee_assignments stores no time window', () => {
  const schema = buildMigrationSchema();
  const duties = schema.columns.get('referee_assignments');
  const sessions = schema.columns.get('workshop_sessions');

  it('reads both tables from the replay', () => {
    // Without these, the two checks below would pass on a table that is not there.
    expect(duties?.has('person_id')).toBe(true);
    expect(sessions?.has('workshop_id')).toBe(true);
  });

  it.each(['starts_at', 'ends_at'])('has no %s column', (column) => {
    expect(duties?.has(column), `referee_assignments.${column} is back`).toBe(false);
  });

  it.each(['starts_at', 'ends_at'])('leaves workshop_sessions.%s in place', (column) => {
    expect(sessions?.has(column)).toBe(true);
  });
});
