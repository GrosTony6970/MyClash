import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from '../../common/testing/migration-schema';
import { SUBJECT_EXPORT_TABLES } from './subject-export.tables';

/**
 * Does every declared reach name the id space its column really holds?
 *
 * A `person` reach is looked up by the subject's EVENT person ids, a `global_person` reach by
 * their global ids. Declare the wrong one and the lookup finds nothing — silently: the export
 * looks complete. Migration 0062 made the referee tables' `person_id` a global id, and the map
 * kept reaching `referee_assignments` (fixed in W1.4), `event_referees`, its day and Tournament
 * lists and `event_instructors` as event persons, so a referee's roster rows never left.
 *
 * The truth is the column's foreign key, replayed from the migrations and followed through a
 * composite key (`event_referee_days (event_id, person_id)` → `event_referees` →
 * `global_persons`). A column with no foreign key cannot be checked here.
 */

const schema = buildMigrationSchema();
const PERSON_TABLES = new Set(['persons', 'global_persons']);

/** The person table a column's foreign key ends at, following keys into other tables. */
function personTableOf(table: string, column: string): string | null {
  let target = schema.references.get(normaliseTable(table))?.get(column.toLowerCase());
  for (let hop = 0; target && hop < 5; hop++) {
    if (PERSON_TABLES.has(target.table)) return target.table;
    target = schema.references.get(target.table)?.get(target.column);
  }
  return null;
}

const EXPECTED_TABLE = { person: 'persons', global_person: 'global_persons' } as const;

describe('subject export reaches', () => {
  it('follows foreign keys, composite ones included (sanity check on the replay)', () => {
    expect(personTableOf('event_passes', 'person_id')).toBe('persons');
    expect(personTableOf('referee_assignments', 'person_id')).toBe('global_persons');
    // 0077: (event_id, person_id) → event_referees (event_id, person_id); 0062: → global_persons.
    expect(personTableOf('event_referee_days', 'person_id')).toBe('global_persons');
    // 0001 declared `persons.global_fighter_id REFERENCES fighters`; 0023 renamed the column and
    // the table. The key follows both renames.
    expect(personTableOf('persons', 'global_person_id')).toBe('global_persons');
    // 0163 added the key with `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`.
    expect(personTableOf('referee_compensation_payments', 'person_id')).toBe('global_persons');
  });

  it('declares each person reach in the id space its foreign key names', () => {
    const wrong: string[] = [];
    const unchecked: string[] = [];
    let checked = 0;
    for (const [table, spec] of Object.entries(SUBJECT_EXPORT_TABLES)) {
      for (const { column, reach } of spec.reaches) {
        if (reach !== 'person' && reach !== 'global_person') continue;
        const actual = personTableOf(table, column);
        if (actual === null) {
          unchecked.push(`${table}.${column}`);
          continue;
        }
        checked += 1;
        if (actual !== EXPECTED_TABLE[reach]) {
          wrong.push(`${table}.${column}: declared '${reach}', its foreign key names ${actual}`);
        }
      }
    }
    expect(checked, 'the replay found no person foreign key at all').toBeGreaterThan(20);
    expect(wrong).toEqual([]);
    // No foreign key to follow: each was checked by hand against the code that writes it (a
    // persons.id for the two workshop columns, 0134 / feedback.service.ts; a global id for the
    // AI log, 0121 / ai-providers.service.ts). A new one must be judged, then added here.
    expect(unchecked).toEqual([
      'workshop_enrollments.user_id',
      'workshop_feedback.rater_person_id',
      'fighter_ai_usage_log.global_person_id',
    ]);
  });
});
