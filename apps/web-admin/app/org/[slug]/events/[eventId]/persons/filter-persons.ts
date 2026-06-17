/**
 * Club + referee + instructor filter predicate for the event Persons
 * page, applied inside the page's filteredPersons memo alongside the
 * name search and the tournament tabs. Referee/instructor status keys
 * on global_persons.id (the event_referees / event_instructors
 * identity), matched against person.globalPersonId — the same
 * comparison the page's Referee / Instructor columns use.
 *
 * Pure: no React, no I/O.
 */

export interface PersonFilterValue {
  /** 'all' | 'none' (persons without a club) | a clubId. */
  club: string;
  referee: 'all' | 'referee' | 'non_referee';
  /** Optional — absent is treated as 'all'. */
  instructor?: 'all' | 'instructor' | 'non_instructor';
}

export function personMatchesFilter(
  person: { clubId: string | null; globalPersonId: string | null },
  filter: PersonFilterValue,
  refereePersonIds: ReadonlySet<string>,
  instructorPersonIds: ReadonlySet<string> = new Set(),
): boolean {
  if (filter.club !== 'all') {
    if (filter.club === 'none' ? person.clubId !== null : person.clubId !== filter.club) {
      return false;
    }
  }
  if (filter.referee !== 'all') {
    const isReferee = person.globalPersonId !== null && refereePersonIds.has(person.globalPersonId);
    if (filter.referee === 'referee' ? !isReferee : isReferee) return false;
  }
  if (filter.instructor && filter.instructor !== 'all') {
    const isInstructor =
      person.globalPersonId !== null && instructorPersonIds.has(person.globalPersonId);
    if (filter.instructor === 'instructor' ? !isInstructor : isInstructor) return false;
  }
  return true;
}
