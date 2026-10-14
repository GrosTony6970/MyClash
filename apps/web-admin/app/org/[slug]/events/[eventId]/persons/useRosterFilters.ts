'use client';

/**
 * The roster's name search and its three header filters, kept in the address (quick win
 * O19) so a refresh keeps them, as the Tournament tab is (O7). Each write builds on the
 * address as it is NOW, not on the render's copy: the Tournament tab writes there too,
 * and the waiting list lives in the hash. A filter at its default leaves the address.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { PersonFilterValue } from './filter-persons';

type RefereeFilter = PersonFilterValue['referee'];
type InstructorFilter = NonNullable<PersonFilterValue['instructor']>;

const REFEREE: readonly RefereeFilter[] = ['all', 'referee', 'non_referee'];
const INSTRUCTOR: readonly InstructorFilter[] = ['all', 'instructor', 'non_instructor'];

/** An address value this page does not know reads as the default, never as a filter. */
function oneOf<T extends string>(known: readonly T[], value: string | null): T {
  return known.find((option) => option === value) ?? known[0]!;
}

export function useRosterFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const write = useCallback(
    (key: string, value: string, fallback: string) => {
      const url = new URL(window.location.href);
      if (value && value !== fallback) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    },
    [router],
  );

  return {
    search: searchParams.get('q') ?? '',
    clubFilter: searchParams.get('club') ?? 'all',
    refereeFilter: oneOf(REFEREE, searchParams.get('referee')),
    instructorFilter: oneOf(INSTRUCTOR, searchParams.get('instructor')),
    setSearch: (value: string) => write('q', value, ''),
    setClubFilter: (value: string) => write('club', value, 'all'),
    setRefereeFilter: (value: RefereeFilter) => write('referee', value, 'all'),
    setInstructorFilter: (value: InstructorFilter) => write('instructor', value, 'all'),
  };
}
