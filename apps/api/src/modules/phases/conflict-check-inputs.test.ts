import { describe, expect, it } from 'vitest';
import { detectFighterRefereeConflicts } from '@myclash/rulesets/scheduling';
import {
  toConflictAssignments,
  toConflictMatches,
  toRegistrationPersonMap,
} from './conflict-check-inputs';

describe('toConflictAssignments', () => {
  it('projects a per-match assignment with its bout label and time', () => {
    expect(
      toConflictAssignments([
        {
          match_id: 'm-1',
          role: 'head',
          global_persons: { id: 'gp-1', given_name: 'Ada', family_name: 'Lovelace' },
          matches: { match_number_label: 'LSW-P1-M1', scheduled_at: '2026-08-15T09:00:00Z' },
        },
      ]),
    ).toEqual([
      {
        matchId: 'm-1',
        matchLabel: 'LSW-P1-M1',
        personId: 'gp-1',
        personName: 'Ada Lovelace',
        role: 'head',
        scheduledAt: '2026-08-15T09:00:00Z',
        durationMinutes: 5,
      },
    ]);
  });

  it('drops an assignment whose referee cannot be identified', () => {
    expect(
      toConflictAssignments([
        { match_id: 'm-1', role: 'head', global_persons: null },
        { match_id: 'm-2', role: 'head', global_persons: { given_name: 'No', family_name: 'Id' } },
      ]),
    ).toEqual([]);
  });
});

describe('toRegistrationPersonMap', () => {
  it('keys on the global person id, not the per-event person id', () => {
    expect(
      toRegistrationPersonMap([
        {
          id: 'reg-1',
          persons: { id: 'local-1', global_person_id: 'gp-1', given_name: 'Ada' },
        },
      ]),
    ).toEqual([{ registrationId: 'reg-1', personId: 'gp-1', personName: 'Ada' }]);
  });

  it('drops a registration whose person has no global identity', () => {
    expect(
      toRegistrationPersonMap([
        { id: 'reg-1', persons: { id: 'local-1', global_person_id: null } },
      ]),
    ).toEqual([]);
  });
});

/**
 * The defect, end to end, through the real detector.
 *
 * Two people who cannot be identified — an unlinked referee on one bout, an
 * unlinked fighter in another that overlaps it. Defaulting both to `''` made the
 * detector treat them as ONE person and report a hard-rule-8 violation between
 * two strangers.
 */
describe('the empty-id collision', () => {
  const rows = {
    matches: [
      {
        id: 'm-1',
        match_number_label: 'LSW-P1-M1',
        red_registration_id: 'reg-unlinked',
        blue_registration_id: 'reg-other',
        scheduled_at: '2026-08-15T09:00:00Z',
      },
      {
        id: 'm-2',
        match_number_label: 'LSW-P2-M1',
        red_registration_id: 'reg-x',
        blue_registration_id: 'reg-y',
        scheduled_at: '2026-08-15T09:00:00Z',
      },
    ],
    // Refereeing m-2, identity unresolvable.
    assignments: [{ match_id: 'm-2', role: 'head', global_persons: null }],
    // Fighting in m-1, identity unresolvable. A DIFFERENT person.
    registrations: [{ id: 'reg-unlinked', persons: { id: 'local-1', global_person_id: null } }],
  };

  it('reports no conflict between two people it cannot name', () => {
    const result = detectFighterRefereeConflicts(
      toConflictMatches(rows.matches),
      toConflictAssignments(rows.assignments),
      toRegistrationPersonMap(rows.registrations),
    );

    expect(result.conflicts).toEqual([]);
  });

  /** The same inputs with the old `?? ''` defaults, to show what was reported. */
  it('would report one if the unresolvable rows were kept under an empty id', () => {
    const result = detectFighterRefereeConflicts(
      toConflictMatches(rows.matches),
      [
        {
          matchId: 'm-2',
          matchLabel: 'LSW-P2-M1',
          personId: '',
          personName: '',
          role: 'head',
          scheduledAt: '2026-08-15T09:00:00Z',
          durationMinutes: 5,
        },
      ],
      [{ registrationId: 'reg-unlinked', personId: '', personName: '' }],
    );

    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});
