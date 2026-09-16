import { describe, expect, it } from 'vitest';
import { detectFighterRefereeConflicts } from '@myclash/rulesets/scheduling';
import {
  toConflictAssignments,
  toConflictMatches,
  toRegistrationPersonMap,
} from './conflict-check-inputs';

describe('toConflictAssignments', () => {
  it('projects a per-match assignment with its bout label, time and planned length', () => {
    expect(
      toConflictAssignments(
        [
          {
            match_id: 'm-1',
            role: 'head',
            global_persons: { id: 'gp-1', given_name: 'Ada', family_name: 'Lovelace' },
            matches: { match_number_label: 'LSW-P1-M1', scheduled_at: '2026-08-15T09:00:00Z' },
          },
        ],
        new Map([['m-1', 12]]),
      ),
    ).toEqual([
      {
        matchId: 'm-1',
        matchLabel: 'LSW-P1-M1',
        personId: 'gp-1',
        personName: 'Ada Lovelace',
        role: 'head',
        scheduledAt: '2026-08-15T09:00:00Z',
        durationMinutes: 12,
      },
    ]);
  });

  it('drops an assignment whose referee cannot be identified', () => {
    expect(
      toConflictAssignments(
        [
          { match_id: 'm-1', role: 'head', global_persons: null },
          {
            match_id: 'm-2',
            role: 'head',
            global_persons: { given_name: 'No', family_name: 'Id' },
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
  });

  it('throws for a Match with no planned length rather than guessing one', () => {
    expect(() =>
      toConflictAssignments(
        [{ match_id: 'm-9', role: 'head', global_persons: { id: 'gp-1' } }],
        new Map([['m-1', 5]]),
      ),
    ).toThrow('No planned length for match m-9');
  });
});

describe('toConflictMatches', () => {
  it("measures each bout with its own Match's planned length", () => {
    const row = {
      phase_id: 'p1',
      planned_duration_override_minutes: null,
      red_registration_id: 'reg-a',
      blue_registration_id: 'reg-b',
      scheduled_at: '2026-08-15T09:00:00Z',
    };

    expect(
      toConflictMatches(
        [
          { ...row, id: 'm-1' },
          { ...row, id: 'm-2' },
        ],
        new Map([
          ['m-1', 7],
          ['m-2', 12],
        ]),
      ).map((match) => [match.id, match.durationMinutes]),
    ).toEqual([
      ['m-1', 7],
      ['m-2', 12],
    ]);
  });

  it('throws for a Match with no planned length rather than guessing one', () => {
    expect(() =>
      toConflictMatches(
        [{ id: 'm-9', phase_id: 'p1', planned_duration_override_minutes: null }],
        new Map(),
      ),
    ).toThrow('No planned length for match m-9');
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
        phase_id: 'p1',
        planned_duration_override_minutes: null,
        match_number_label: 'LSW-P1-M1',
        red_registration_id: 'reg-unlinked',
        blue_registration_id: 'reg-other',
        scheduled_at: '2026-08-15T09:00:00Z',
      },
      {
        id: 'm-2',
        phase_id: 'p2',
        planned_duration_override_minutes: null,
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
    lengths: new Map([
      ['m-1', 5],
      ['m-2', 5],
    ]),
  };

  it('reports no conflict between two people it cannot name', () => {
    const result = detectFighterRefereeConflicts(
      toConflictMatches(rows.matches, rows.lengths),
      toConflictAssignments(rows.assignments, rows.lengths),
      toRegistrationPersonMap(rows.registrations),
    );

    expect(result.conflicts).toEqual([]);
  });

  /** The same inputs with the old `?? ''` defaults, to show what was reported. */
  it('would report one if the unresolvable rows were kept under an empty id', () => {
    const result = detectFighterRefereeConflicts(
      toConflictMatches(rows.matches, rows.lengths),
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
