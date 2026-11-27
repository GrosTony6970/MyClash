/**
 * A new team's slug: its name as a slug, `-2`, `-3` … when taken, `team-N` when the name slugs to
 * fewer than the 2 characters `teams_slug_shape` (0281) allows.
 */
import { describe, expect, it } from 'vitest';
import { pickTeamSlug } from './team-slug';

const SHAPE = /^[a-z0-9-]{2,100}$/;

describe('pickTeamSlug', () => {
  it('slugs the name, accents and spaces folded', () => {
    expect(pickTeamSlug('Lames de Lyon Épée', new Set())).toBe('lames-de-lyon-epee');
  });

  it('suffixes -2, then -3, when the slug is taken in the Tournament', () => {
    expect(pickTeamSlug('Lyon Blades', new Set(['lyon-blades']))).toBe('lyon-blades-2');
    expect(pickTeamSlug('Lyon-Blades!', new Set(['lyon-blades', 'lyon-blades-2']))).toBe(
      'lyon-blades-3',
    );
  });

  it('falls back to the first free team-N when the name slugs to fewer than 2 characters', () => {
    expect(pickTeamSlug('A', new Set())).toBe('team-1');
    expect(pickTeamSlug('!!', new Set(['team-1', 'team-2']))).toBe('team-3');
  });

  it('keeps a 2-character slug', () => {
    expect(pickTeamSlug('B2', new Set())).toBe('b2');
  });

  it('always answers a slug the table accepts', () => {
    for (const name of ['A', 'Ω', 'Lyon Blades', 'x'.repeat(120)]) {
      expect(pickTeamSlug(name, new Set())).toMatch(SHAPE);
    }
  });
});
