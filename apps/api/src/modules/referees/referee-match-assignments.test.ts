import { describe, expect, it } from 'vitest';
import {
  toRefereeMatchAssignments,
  toRegistrationPersons,
  type RawRefereeAssignmentRow,
  type RawRegistrationRow,
} from './referee-match-assignments';

describe('toRefereeMatchAssignments', () => {
  it('projects a per-match assignment with the global person id', () => {
    const rows: RawRefereeAssignmentRow[] = [
      {
        match_id: 'm-1',
        role: 'head',
        global_persons: { id: 'gp-1', given_name: 'Ada', family_name: 'Lovelace' },
      },
    ];

    expect(toRefereeMatchAssignments(rows)).toEqual([
      { matchId: 'm-1', personId: 'gp-1', personName: 'Ada Lovelace', role: 'head' },
    ]);
  });

  it('prefers a display name over the given/family pair', () => {
    const rows: RawRefereeAssignmentRow[] = [
      {
        match_id: 'm-1',
        role: 'head',
        global_persons: {
          id: 'gp-1',
          given_name: 'Ada',
          family_name: 'Lovelace',
          display_name: 'A. Lovelace',
        },
      },
    ];

    expect(toRefereeMatchAssignments(rows)[0]?.personName).toBe('A. Lovelace');
  });

  /** PostgREST returns a to-one embed as an object, or as a one-element array
   *  when it resolves through a unique constraint. Both reach this code. */
  it('reads the person embed whether it arrives as an object or a one-element array', () => {
    const asArray: RawRefereeAssignmentRow[] = [
      {
        match_id: 'm-1',
        role: 'head',
        global_persons: [{ id: 'gp-1', given_name: 'Ada', family_name: 'Lovelace' }],
      },
    ];

    expect(toRefereeMatchAssignments(asArray)).toEqual([
      { matchId: 'm-1', personId: 'gp-1', personName: 'Ada Lovelace', role: 'head' },
    ]);
  });

  /**
   * THE RULE. Emitting an unresolvable row under `''` would collapse every such
   * row onto one key, and the detector keys its lookup by person — so an
   * unidentified referee would "match" every unidentified fighter and the board
   * would raise a conflict for two people it cannot even name.
   */
  it('drops a row it cannot resolve to a person rather than keying it under an empty id', () => {
    const rows: RawRefereeAssignmentRow[] = [
      { match_id: 'm-1', role: 'head', global_persons: null },
      { match_id: 'm-2', role: 'head', global_persons: { given_name: 'No', family_name: 'Id' } },
      { match_id: 'm-3', role: 'head' },
    ];

    expect(toRefereeMatchAssignments(rows)).toEqual([]);
  });

  it('drops an assignment with no bout or no role', () => {
    const rows: RawRefereeAssignmentRow[] = [
      { match_id: null, role: 'head', global_persons: { id: 'gp-1' } },
      { match_id: 'm-1', role: null, global_persons: { id: 'gp-1' } },
    ];

    expect(toRefereeMatchAssignments(rows)).toEqual([]);
  });

  it('keeps one row per role when a bout has a crew', () => {
    const rows: RawRefereeAssignmentRow[] = [
      { match_id: 'm-1', role: 'head', global_persons: { id: 'gp-1', given_name: 'Ada' } },
      { match_id: 'm-1', role: 'side', global_persons: { id: 'gp-2', given_name: 'Grace' } },
    ];

    expect(toRefereeMatchAssignments(rows)).toHaveLength(2);
  });
});

describe('toRegistrationPersons', () => {
  /**
   * `persons.global_person_id`, never `persons.id`. The two are different id
   * spaces; projecting the per-event one produces a map that matches no referee
   * assignment at all, so the board stays silent and looks healthy.
   */
  it('keys on the global person id, not the per-event person id', () => {
    const rows: RawRegistrationRow[] = [
      {
        id: 'reg-1',
        persons: {
          id: 'person-local-1',
          global_person_id: 'gp-1',
          given_name: 'Ada',
          family_name: 'Lovelace',
        },
      },
    ];

    expect(toRegistrationPersons(rows)).toEqual([
      { registrationId: 'reg-1', personId: 'gp-1', personName: 'Ada Lovelace' },
    ]);
  });

  it('reads the person embed whether it arrives as an object or a one-element array', () => {
    const rows: RawRegistrationRow[] = [
      { id: 'reg-1', persons: [{ id: 'person-local-1', global_person_id: 'gp-1' }] },
    ];

    expect(toRegistrationPersons(rows)[0]?.personId).toBe('gp-1');
  });

  /** Same rule as the assignments side, and the reason it matters is the same:
   *  two unlinked fighters must not collapse onto one key. */
  it('drops a registration whose person has no global identity', () => {
    const rows: RawRegistrationRow[] = [
      { id: 'reg-1', persons: { id: 'person-local-1', global_person_id: null } },
      { id: 'reg-2', persons: { id: 'person-local-2' } },
      { id: 'reg-3', persons: null },
    ];

    expect(toRegistrationPersons(rows)).toEqual([]);
  });

  /**
   * The false alarm this prevents, stated end to end: two people with no global
   * identity must not end up sharing a key, because the detector would then read
   * them as the same body.
   */
  it('never produces two rows that share an id when neither person is linked', () => {
    const rows: RawRegistrationRow[] = [
      { id: 'reg-1', persons: { id: 'person-local-1', global_person_id: null } },
      { id: 'reg-2', persons: { id: 'person-local-2', global_person_id: null } },
    ];

    const ids = toRegistrationPersons(rows).map((r) => r.personId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries an empty name through rather than dropping an identified person', () => {
    const rows: RawRegistrationRow[] = [{ id: 'reg-1', persons: { global_person_id: 'gp-1' } }];

    expect(toRegistrationPersons(rows)).toEqual([
      { registrationId: 'reg-1', personId: 'gp-1', personName: '' },
    ]);
  });
});
