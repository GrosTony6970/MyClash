import { describe, expect, it } from 'vitest';
import { mapGlobalPersonSuggestion } from './global-person-mapper';

describe('mapGlobalPersonSuggestion', () => {
  it('maps a snake_case API row with nested clubs to a camelCase suggestion', () => {
    const row = {
      id: 'gp-1',
      display_name: 'Jean Dupont',
      given_name: 'Jean',
      family_name: 'Dupont',
      hema_ratings_id: 'hr-12345',
      clubs: { id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAMHE' },
    };

    expect(mapGlobalPersonSuggestion(row)).toEqual({
      id: 'gp-1',
      displayName: 'Jean Dupont',
      givenName: 'Jean',
      familyName: 'Dupont',
      clubId: 'club-1',
      clubLabel: 'Lyon AMHE',
      hemaRatingsId: 'hr-12345',
    });
  });

  it('returns null for clubId and clubLabel when the nested clubs object is absent', () => {
    expect(
      mapGlobalPersonSuggestion({
        id: 'gp-2',
        display_name: 'Marie Martin',
        given_name: 'Marie',
        family_name: 'Martin',
        hema_ratings_id: null,
        clubs: null,
      }),
    ).toEqual({
      id: 'gp-2',
      displayName: 'Marie Martin',
      givenName: 'Marie',
      familyName: 'Martin',
      clubId: null,
      clubLabel: null,
      hemaRatingsId: null,
    });
  });
});
