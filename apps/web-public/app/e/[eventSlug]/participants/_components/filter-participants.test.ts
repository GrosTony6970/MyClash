import { describe, expect, it } from 'vitest';
import { filterParticipants, type ParticipantLike } from './filter-participants';

const p = (overrides: Partial<ParticipantLike>): ParticipantLike => ({
  personId: overrides.personId ?? 'pid',
  displayName: overrides.displayName ?? '',
  clubName: overrides.clubName ?? null,
  clubAbbrev: overrides.clubAbbrev ?? null,
  tournaments: overrides.tournaments ?? [],
});

describe('filterParticipants', () => {
  it('returns the full list when the query is empty', () => {
    const list = [p({ personId: '1' }), p({ personId: '2' })];
    expect(filterParticipants(list, '').map((x) => x.personId)).toEqual(['1', '2']);
  });

  it('matches name case-insensitively', () => {
    const list = [
      p({ personId: 'a', displayName: 'Alice Dupont' }),
      p({ personId: 'b', displayName: 'Bob Martin' }),
    ];
    expect(filterParticipants(list, 'DUPONT').map((x) => x.personId)).toEqual(['a']);
  });

  it('matches club name + abbrev', () => {
    const list = [
      p({ personId: 'a', clubName: 'Lyon AMHE', clubAbbrev: 'LAMHE' }),
      p({ personId: 'b', clubName: 'Paris HEMA', clubAbbrev: 'PH' }),
    ];
    expect(filterParticipants(list, 'lamhe').map((x) => x.personId)).toEqual(['a']);
    expect(filterParticipants(list, 'paris').map((x) => x.personId)).toEqual(['b']);
  });

  it('trims whitespace from the query', () => {
    const list = [p({ personId: 'a', displayName: 'Alice' })];
    expect(filterParticipants(list, '   alice   ').map((x) => x.personId)).toEqual(['a']);
  });
});
