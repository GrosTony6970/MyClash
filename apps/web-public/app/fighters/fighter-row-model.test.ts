import { describe, expect, it } from 'vitest';
import { toFighterRowModel, toFighterRowModels } from './fighter-row-model';

const API_ROW = {
  id: 'gp-1',
  slug: 'jean-dupont',
  displayName: 'Jean Dupont',
  givenName: 'Jean',
  familyName: 'Dupont',
  photoUrl: 'https://cdn/x.jpg',
  countryCode: 'FR',
  clubName: 'Garde Noire',
  clubSlug: 'garde-noire',
  weapons: ['Longsword', 'Rapier'],
};

describe('toFighterRowModel', () => {
  it('links the row to the profile and the club to its page', () => {
    const row = toFighterRowModel(API_ROW);
    expect(row.href).toBe('/fighters/jean-dupont');
    expect(row.clubHref).toBe('/clubs/garde-noire');
  });

  it('omits the club link when there is no public club page', () => {
    // `/clubs/` with no slug is a 404. A club name with no page is still worth
    // showing; a link to nothing is not.
    const row = toFighterRowModel({ ...API_ROW, clubSlug: null });
    expect(row.clubName).toBe('Garde Noire');
    expect(row.clubHref).toBeNull();
  });

  it('falls back through the name parts to the slug', () => {
    // display_name is NOT NULL in the schema, but a row imported with a blank
    // one would render as an empty link with nothing for a screen reader to
    // announce.
    expect(toFighterRowModel({ ...API_ROW, displayName: '   ' }).name).toBe('Jean Dupont');
    expect(
      toFighterRowModel({ ...API_ROW, displayName: '', givenName: '', familyName: '' }).name,
    ).toBe('jean-dupont');
  });

  it('normalises blanks to null so no renderer prints an empty string', () => {
    const row = toFighterRowModel({
      ...API_ROW,
      photoUrl: '  ',
      countryCode: '',
      clubName: '   ',
    });
    expect(row.photoUrl).toBeNull();
    expect(row.countryCode).toBeNull();
    expect(row.clubName).toBeNull();
  });

  it('drops blank weapons rather than rendering an empty chip', () => {
    expect(toFighterRowModel({ ...API_ROW, weapons: ['Longsword', '', '  '] }).weapons).toEqual([
      'Longsword',
    ]);
  });

  it('feeds the desktop table and the mobile cards IDENTICAL data', () => {
    // The directory renders a real <table> at md+ and a card list below it.
    // Two renderings of one row are two chances to disagree, and a column that
    // formats differently by breakpoint is a bug nobody sees until they rotate
    // their phone. Both branches map over this one list.
    const rows = toFighterRowModels([API_ROW, { ...API_ROW, id: 'gp-2', slug: 'a-b' }]);
    const again = toFighterRowModels([API_ROW, { ...API_ROW, id: 'gp-2', slug: 'a-b' }]);
    expect(rows).toEqual(again);
    expect(rows.map((r) => r.id)).toEqual(['gp-1', 'gp-2']);
  });

  it('preserves the order the API returned', () => {
    // The API returns rows in the RPC's relevance ranking. Re-sorting here
    // would silently reorder only the visible page.
    const ids = ['c', 'a', 'b'].map((id) => ({ ...API_ROW, id, slug: id }));
    expect(toFighterRowModels(ids).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
