import { describe, expect, it } from 'vitest';
import { computeClubPickerRows, type ClubSuggestion, type ClubPickerRow } from './club-picker-rows';

const lyon: ClubSuggestion = { id: 'c-lyon', name: 'Lyon AMHE', abbreviation: 'LYO' };
const paris: ClubSuggestion = { id: 'c-paris', name: 'Paris Fencing', abbreviation: 'PAR' };

describe('computeClubPickerRows', () => {
  it('returns an empty array when typed text is blank', () => {
    expect(computeClubPickerRows('', [lyon, paris])).toEqual([]);
    expect(computeClubPickerRows('   ', [lyon, paris])).toEqual([]);
  });

  it('returns only existing-club rows when the typed text exact-matches a suggestion', () => {
    // When the user has typed the full name of an existing club, the dropdown
    // shows all suggestions but suppresses the create-row (no accidental
    // duplicate creation). Other suggestions are still shown so the user can
    // pick a different one without clearing the field first.
    const rows = computeClubPickerRows('Lyon AMHE', [lyon, paris]);
    expect(rows).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'existing', club: paris },
    ]);
  });

  it('appends a create-row when the typed text has no case-insensitive exact match', () => {
    const rows = computeClubPickerRows('Bordeaux Sword Club', [lyon, paris]);
    expect(rows).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'existing', club: paris },
      { kind: 'create', name: 'Bordeaux Sword Club' },
    ]);
  });

  it('does NOT append a create-row when an existing club matches case-insensitively', () => {
    // Typo casing or trailing space should still match the existing club, not offer a duplicate.
    expect(computeClubPickerRows('lyon amhe', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
    ]);
    expect(computeClubPickerRows('  LYON AMHE  ', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
    ]);
  });

  it('offers a create-row even when there are zero suggestions', () => {
    expect(computeClubPickerRows('Brand New Club', [])).toEqual<ClubPickerRow[]>([
      { kind: 'create', name: 'Brand New Club' },
    ]);
  });

  it('preserves the user-typed casing in the create-row name (trims whitespace)', () => {
    expect(computeClubPickerRows('  Lyon AMHE 2  ', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'create', name: 'Lyon AMHE 2' },
    ]);
  });
});
