import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';
import {
  MAX_CANDIDATES,
  rosterAddCandidates,
  rosterAddedWords,
  rosterAddRefusal,
  type EventPerson,
} from './roster-add';

/**
 * Who "Add a person" offers, and what it says (operator rulings 535, 536). Léa Martin is one of the
 * Event's people; Paul Durand is already booked on this session.
 */

const person = (id: string, givenName: string, familyName: string): EventPerson => ({
  id,
  givenName,
  familyName,
  clubLabel: null,
});
const LEA = person('lea-row', 'Léa', 'Martin');
const PAUL = person('paul-row', 'Paul', 'Durand');
const PEOPLE = [LEA, PAUL, person('leo-row', 'Léo', 'Petit')];

/** Says the key and its values, so a test reads which sentence was picked. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as Translator;

const refusal = (code: string | null, status = 409): ApiFailure => ({
  kind: 'http',
  status,
  code,
  detail: 'English sentence of the server',
  details: null,
  validationErrors: null,
});

describe('the people "Add a person" offers', () => {
  it('finds a person by a name typed without accents, in any order', () => {
    expect(rosterAddCandidates(PEOPLE, new Set(), 'martin lea')).toEqual([LEA]);
  });

  it('offers nobody before anything is typed', () => {
    expect(rosterAddCandidates(PEOPLE, new Set(), '  ')).toEqual([]);
  });

  it('leaves out the people already on the roster, by their roster row', () => {
    expect(rosterAddCandidates(PEOPLE, new Set(['paul-row']), 'paul')).toEqual([]);
    // A linked entry carries the profile's id elsewhere: only the roster row hides a person.
    expect(rosterAddCandidates(PEOPLE, new Set(['paul-profile']), 'paul')).toEqual([PAUL]);
  });

  it(`offers at most ${MAX_CANDIDATES}`, () => {
    const many = Array.from({ length: 12 }, (_, i) => person(`p-${i}`, 'Anne', `Roux ${i}`));
    expect(rosterAddCandidates(many, new Set(), 'anne')).toHaveLength(MAX_CANDIDATES);
  });
});

describe('what an add says', () => {
  it('names the seat, or the place on the waiting list (536)', () => {
    expect(rosterAddedWords({ name: 'Léa Martin', status: 'confirmed' }, t)).toBe(
      'organizer.workshopsPage.add.seat {"name":"Léa Martin"}',
    );
    expect(rosterAddedWords({ name: 'Léa Martin', status: 'waitlisted', position: 3 }, t)).toBe(
      'organizer.workshopsPage.add.waitlisted {"name":"Léa Martin","position":3}',
    );
  });

  it.each([
    ['WORKSHOP_ALREADY_BOOKED', 'otherSession'],
    ['INSTRUCTOR_SELF_ENROLLMENT', 'teaches'],
    ['WORKSHOP_BOOKING_REFUSED', 'refused'],
    ['WORKSHOP_SESSION_CANCELLED', 'sessionCancelled'],
    ['PERSON_NOT_IN_EVENT', 'notInEvent'],
    ['NOT_FOUND', 'sessionGone'],
  ])('says a %s refusal in its own words, never the server English', (code, key) => {
    expect(rosterAddRefusal(refusal(code), t)).toBe(`organizer.workshopsPage.add.${key}`);
  });

  it('leaves any other failure to the shared wording', () => {
    expect(rosterAddRefusal(refusal(null, 500), t)).toBe('organizer.workshopsPage.add.failed');
  });
});
