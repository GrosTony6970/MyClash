import { describe, expect, it } from 'vitest';
import { hiddenPicked, shownPeople, withShown, type Recipient } from './recipients';

/** O5 (ruled 2026-10-14): the people picker of a broadcast. */
const person = (id: string, givenName: string, clubLabel: string | null = null): Recipient => ({
  id,
  givenName,
  familyName: 'Roux',
  email: `${id}@example.org`,
  clubLabel,
});
const LEA = person('p-1', 'Léa', 'Lyon Escrime');
const TOM = person('p-2', 'Tom', 'Salle Dijon');
const ANA = person('p-3', 'Ana');

describe('the people picker', () => {
  it('finds a person whatever the accents, and by club', () => {
    expect(shownPeople([LEA, TOM, ANA], 'lea')).toEqual([LEA]);
    expect(shownPeople([LEA, TOM, ANA], 'dijon')).toEqual([TOM]);
    expect(shownPeople([LEA, TOM, ANA], '')).toEqual([LEA, TOM, ANA]);
  });

  it('adds the people shown to the ones already picked', () => {
    expect([...withShown(new Set(['p-3']), [LEA, TOM])].sort()).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('counts the picked people the search hides', () => {
    expect(hiddenPicked(new Set(['p-1', 'p-3']), [LEA, TOM])).toBe(1);
    expect(hiddenPicked(new Set(['p-1']), [LEA])).toBe(0);
  });
});
