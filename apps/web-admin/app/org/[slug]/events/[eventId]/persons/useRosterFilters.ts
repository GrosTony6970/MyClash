'use client';

/**
 * The roster's name search and its three header filters, kept in the address (quick win
 * O19) so a refresh keeps them, beside the Tournament tab (O7) and the waiting list's hash.
 */

import { useAddressFilters } from '@/hooks/useAddressFilters';
import type { PersonFilterValue } from './filter-persons';

type RefereeFilter = PersonFilterValue['referee'];
type InstructorFilter = NonNullable<PersonFilterValue['instructor']>;

const REFEREE: readonly RefereeFilter[] = ['all', 'referee', 'non_referee'];
const INSTRUCTOR: readonly InstructorFilter[] = ['all', 'instructor', 'non_instructor'];
const DEFAULTS = { q: '', club: 'all', referee: 'all', instructor: 'all' };

/** An address value this page does not know reads as the default, never as a filter. */
function oneOf<T extends string>(known: readonly T[], value: string): T {
  return known.find((option) => option === value) ?? known[0]!;
}

export function useRosterFilters() {
  const [values, update] = useAddressFilters(DEFAULTS);
  return {
    search: values.q,
    clubFilter: values.club,
    refereeFilter: oneOf(REFEREE, values.referee),
    instructorFilter: oneOf(INSTRUCTOR, values.instructor),
    setSearch: (q: string) => update({ q }),
    setClubFilter: (club: string) => update({ club }),
    setRefereeFilter: (referee: RefereeFilter) => update({ referee }),
    setInstructorFilter: (instructor: InstructorFilter) => update({ instructor }),
  };
}
