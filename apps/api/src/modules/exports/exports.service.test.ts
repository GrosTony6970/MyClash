import { describe, expect, it } from 'vitest';
import { ExportsService } from './exports.service';

type PersonRow = Record<string, unknown>;

function makeService(persons: PersonRow[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve: (value: { data: PersonRow[]; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: persons, error: null })),
  };
  const supabase = { service: { from: () => chain } };
  return new ExportsService(supabase as never);
}

describe('ExportsService.generateFightersCsv — HEMA gender column', () => {
  it('maps persons.gender_category to the HEMA M/F token (blank for mixed/unknown)', async () => {
    const service = makeService([
      {
        given_name: 'Jean',
        family_name: 'Dupont',
        gender_category: 'M',
        hema_ratings_id: '123',
        clubs: { name: 'Lyon', country_code: 'FR' },
      },
      {
        given_name: 'Marie',
        family_name: 'Lefevre',
        gender_category: 'female',
        hema_ratings_id: null,
        clubs: null,
      },
      {
        given_name: 'Alex',
        family_name: 'Roe',
        gender_category: 'mixed',
        hema_ratings_id: null,
        clubs: null,
      },
      {
        given_name: 'Sam',
        family_name: 'Blank',
        gender_category: null,
        hema_ratings_id: null,
        clubs: null,
      },
    ]);

    const csv = await service.generateFightersCsv('event-1');
    const lines = csv.split('\n');

    // Column order: fullName, clubName, nationality, gender, hemaRatingsId
    expect(lines[0]).toBe('Jean Dupont,Lyon,FR,M,123');
    expect(lines[1]?.split(',')[3]).toBe('F'); // "female" → F
    expect(lines[2]?.split(',')[3]).toBe(''); // "mixed" → blank
    expect(lines[3]?.split(',')[3]).toBe(''); // null → blank
  });
});
