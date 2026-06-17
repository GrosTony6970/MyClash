import { describe, expect, it } from 'vitest';
import { personMatchesFilter } from './filter-persons';

const person = (clubId: string | null, globalPersonId: string | null = null) => ({
  clubId,
  globalPersonId,
});

const NO_REFS = new Set<string>();

describe('personMatchesFilter', () => {
  it('keeps only persons of the selected club; "all" keeps everyone', () => {
    expect(personMatchesFilter(person('club-a'), { club: 'club-a', referee: 'all' }, NO_REFS)).toBe(
      true,
    );
    expect(personMatchesFilter(person('club-b'), { club: 'club-a', referee: 'all' }, NO_REFS)).toBe(
      false,
    );
    expect(personMatchesFilter(person('club-b'), { club: 'all', referee: 'all' }, NO_REFS)).toBe(
      true,
    );
  });

  it('"none" keeps only persons without a club', () => {
    expect(personMatchesFilter(person(null), { club: 'none', referee: 'all' }, NO_REFS)).toBe(true);
    expect(personMatchesFilter(person('club-a'), { club: 'none', referee: 'all' }, NO_REFS)).toBe(
      false,
    );
  });

  it('filters referees via globalPersonId membership; null globalPersonId is never a referee', () => {
    const refs = new Set(['gp-1']);
    const filterRef = { club: 'all', referee: 'referee' as const };
    const filterNonRef = { club: 'all', referee: 'non_referee' as const };

    expect(personMatchesFilter(person(null, 'gp-1'), filterRef, refs)).toBe(true);
    expect(personMatchesFilter(person(null, 'gp-2'), filterRef, refs)).toBe(false);
    expect(personMatchesFilter(person(null, null), filterRef, refs)).toBe(false);
    expect(personMatchesFilter(person(null, 'gp-1'), filterNonRef, refs)).toBe(false);
    expect(personMatchesFilter(person(null, null), filterNonRef, refs)).toBe(true);
  });

  it('combines club AND referee', () => {
    const refs = new Set(['gp-1']);
    const filter = { club: 'club-a', referee: 'referee' as const };

    expect(personMatchesFilter(person('club-a', 'gp-1'), filter, refs)).toBe(true);
    expect(personMatchesFilter(person('club-a', 'gp-2'), filter, refs)).toBe(false);
    expect(personMatchesFilter(person('club-b', 'gp-1'), filter, refs)).toBe(false);
  });

  it('filters instructors via globalPersonId membership', () => {
    const instr = new Set(['gp-9']);
    const onlyInstr = { club: 'all', referee: 'all' as const, instructor: 'instructor' as const };
    const nonInstr = {
      club: 'all',
      referee: 'all' as const,
      instructor: 'non_instructor' as const,
    };

    expect(personMatchesFilter(person(null, 'gp-9'), onlyInstr, NO_REFS, instr)).toBe(true);
    expect(personMatchesFilter(person(null, 'gp-1'), onlyInstr, NO_REFS, instr)).toBe(false);
    expect(personMatchesFilter(person(null, 'gp-9'), nonInstr, NO_REFS, instr)).toBe(false);
    expect(personMatchesFilter(person(null, null), nonInstr, NO_REFS, instr)).toBe(true);
  });

  it('absent instructor filter keeps everyone (backward compatible)', () => {
    expect(
      personMatchesFilter(person(null, 'gp-9'), { club: 'all', referee: 'all' }, NO_REFS),
    ).toBe(true);
  });
});
