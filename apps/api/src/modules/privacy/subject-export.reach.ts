/**
 * The vocabulary the subject-export table map is written in.
 *
 * Split from `subject-export.tables.ts` because that file holds a DATASET that
 * grows with every new table on the platform, while this holds a fixed set of
 * concepts. Keeping them together meant the dataset kept pushing the file past
 * the 400-line limit, and the answer to that was never "split the dataset" —
 * the whole point of the map is that it can be read as one list.
 */

/**
 * How a table's rows are reached from a data subject.
 *
 * The three reaches are NOT interchangeable and conflating them is the main
 * correctness risk in this module:
 *  - `uid`           column holds an auth.users id.
 *  - `global_person` column holds a global_persons.id (cross-event identity).
 *  - `person`        column holds a persons.id (the EVENT-SCOPED roster row).
 *
 * The trap: `workshop_enrollments.user_id` is named like a uid but holds a
 * persons.id — guests carry a persons.id with no account at all. Reading it as
 * a uid exports nothing; reading some other table's persons.id as a uid exports
 * A DIFFERENT PERSON'S ROWS. Both failures are silent, which is why the reach is
 * declared per column rather than inferred from the column name.
 *
 * `registration` is the fourth: a `registrations.id`, resolved from the
 * subject's person ids. It exists because a phase roster row (swiss_entrants)
 * names the subject only through their registration, and the coverage guard —
 * which scans for `*user_id` / `*person_id` names and foreign keys to persons —
 * cannot see that at all. Art. 15 is about what we hold, not what a regex
 * notices.
 */
export type SubjectReach = 'uid' | 'global_person' | 'person' | 'registration';

export interface SubjectReachSpec {
  column: string;
  reach: SubjectReach;
}

export interface SubjectTableSpec {
  /** Every way a row in this table can point directly at the subject. */
  reaches: readonly SubjectReachSpec[];
  /** Bundle entry these rows land in. */
  file: string;
  /**
   * Set when rows ALSO reach the subject indirectly (through a match,
   * registration, …). The guard does not check this; the service implements it
   * and its tests pin it. Recorded here so the two stay legible together.
   */
  note?: string;
}
