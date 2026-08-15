import { describe, expect, it } from 'vitest';
import {
  buildRefereeConflictRows,
  type RefereeConflictAssignment,
  type RefereeConflictMatch,
  type RefereeConflictRegistration,
} from './referee-conflict-rows';

/**
 * The live half of hard rule 8, at the join where two id-spaces meet.
 *
 * Every fixture below keeps the registration id and the person id visibly
 * different (`reg-*` against `gp-*`). That is not decoration: the failure this
 * module exists to avoid is keying the map on `persons.id` instead of
 * `global_persons.id`, which produces a join that matches nothing — no rows, no
 * error, a board that looks healthy. A fixture that used one id for both would
 * pass with the wrong column.
 *
 * Times are asserted from a NEW YORK event, not a Paris one. This machine, the
 * app default zone and the drag fixture are all Europe/Paris, so a Paris
 * assertion agrees with a dropped timezone argument and proves nothing.
 */

const TZ = 'America/New_York';
const UNKNOWN = 'Unknown fighter';
/** The detector's last-resort name. Shaped like a real id so a leak is obvious. */
const PERSON_UUID = '6f1e9f42-0000-4000-8000-000000000001';

function match(over: Partial<RefereeConflictMatch> & { id: string }): RefereeConflictMatch {
  return {
    matchNumberLabel: over.id,
    liceId: 'lice-1',
    scheduledAt: '2026-06-13T13:00:00Z',
    durationMinutes: 5,
    redRegistrationId: `reg-red-${over.id}`,
    blueRegistrationId: `reg-blue-${over.id}`,
    ...over,
  };
}

function build(args: {
  matches: RefereeConflictMatch[];
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
}) {
  return buildRefereeConflictRows({ ...args, tz: TZ, unknownPersonLabel: UNKNOWN });
}

describe('buildRefereeConflictRows — overlap', () => {
  it('flags a referee whose own bout runs into the one they officiate', () => {
    const rows = build({
      matches: [
        match({ id: 'A', roundCode: 'LSW-P1-M1', scheduledAt: '2026-06-13T13:00:00Z' }),
        match({ id: 'B', roundCode: 'LSW-P2-M1', scheduledAt: '2026-06-13T13:02:00Z' }),
      ],
      // Denis fights in A (as red) and referees B, two minutes apart.
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([
      {
        kind: 'overlap',
        personName: 'Denis',
        fightingMatchId: 'A',
        fightingLabel: 'LSW-P1-M1',
        fightingTime: '09:00',
        refereeingMatchId: 'B',
        refereeingLabel: 'LSW-P2-M1',
        refereeingTime: '09:02',
        refereeRole: 'declarant',
      },
    ]);
  });

  it('says nothing when the two bouts do not meet', () => {
    const rows = build({
      matches: [
        match({ id: 'A', scheduledAt: '2026-06-13T13:00:00Z', durationMinutes: 5 }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:05:00Z' }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });

  /**
   * The board holds the Unscheduled panel too, and the detector calls any pair
   * with a missing time a "potential" clash. Surfacing those would light up
   * every referee who also fights on a board nobody has scheduled yet.
   */
  it('stays silent while the fighting bout is still unplaced', () => {
    const rows = build({
      matches: [
        match({ id: 'A', scheduledAt: null, liceId: null }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:00:00Z' }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });

  it('stays silent while the officiated bout is still unplaced', () => {
    const rows = build({
      matches: [
        match({ id: 'A', scheduledAt: '2026-06-13T13:00:00Z' }),
        match({ id: 'B', scheduledAt: null, liceId: null }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });

  /** A bout with a time but no piste sits in the panel, not on the grid — the
   *  same test the board itself applies. */
  it('treats a timed bout with no piste as unplaced', () => {
    const rows = build({
      matches: [
        match({ id: 'A', scheduledAt: '2026-06-13T13:00:00Z', liceId: null }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });

  /** The whole point of deriving rather than storing: moving a card changes
   *  the answer with no refetch. */
  it('recomputes from the bouts it is handed — moving one changes the answer', () => {
    const inputs = (fightAt: string) => ({
      matches: [
        match({ id: 'A', scheduledAt: fightAt }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:00:00Z' }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(build(inputs('2026-06-13T13:03:00Z'))).toHaveLength(1);
    expect(build(inputs('2026-06-13T14:00:00Z'))).toHaveLength(0);
  });

  it('reads the blue corner as well as the red', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'table' }],
      registrations: [{ registrationId: 'reg-blue-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows.map((r) => r.fightingMatchId)).toEqual(['A']);
  });

  it('ignores an assignment whose bout the board is not holding', () => {
    const rows = build({
      matches: [match({ id: 'A' })],
      assignments: [
        { matchId: 'ghost', personId: 'gp-denis', personName: 'Denis', role: 'declarant' },
      ],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });

  it('leaves a referee who fights nowhere alone', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: 'gp-elsa', personName: 'Elsa', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([]);
  });
});

describe('buildRefereeConflictRows — own bout', () => {
  /**
   * Both detectors skip this pair on purpose, each deferring to the pool-scoped
   * "cannot referee your own pool" rule. A match-scoped commitment is not a
   * pool, so without this branch nothing in the product says a word.
   */
  it('flags a referee committed to the very bout they fight in', () => {
    const rows = build({
      matches: [match({ id: 'A', roundCode: 'LSW-P1-M1' })],
      assignments: [{ matchId: 'A', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toEqual([
      {
        kind: 'own_bout',
        personName: 'Denis',
        fightingMatchId: 'A',
        fightingLabel: 'LSW-P1-M1',
        fightingTime: '09:00',
        refereeingMatchId: 'A',
        refereeingLabel: 'LSW-P1-M1',
        refereeingTime: '09:00',
        refereeRole: 'declarant',
      },
    ]);
  });

  /** Unlike the overlap rule, this one does not depend on the clock, so an
   *  unplaced bout still counts. */
  it('flags it before the bout is placed, with no time to show', () => {
    const rows = build({
      matches: [match({ id: 'A', scheduledAt: null, liceId: null })],
      assignments: [{ matchId: 'A', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('own_bout');
    expect(rows[0]?.fightingTime).toBe('');
  });

  it('says it once when the same person holds two roles on that bout', () => {
    const rows = build({
      matches: [match({ id: 'A' })],
      assignments: [
        { matchId: 'A', personId: 'gp-denis', personName: 'Denis', role: 'declarant' },
        { matchId: 'A', personId: 'gp-denis', personName: 'Denis', role: 'table' },
      ],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toHaveLength(1);
  });

  it('does not double-report it as an overlap', () => {
    const rows = build({
      matches: [match({ id: 'A' })],
      assignments: [{ matchId: 'A', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['own_bout']);
  });

  it('puts the own-bout finding above the overlaps', () => {
    const rows = build({
      matches: [
        match({ id: 'A' }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' }),
        match({ id: 'C', scheduledAt: '2026-06-13T13:01:00Z' }),
      ],
      assignments: [
        { matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' },
        { matchId: 'C', personId: 'gp-elsa', personName: 'Elsa', role: 'declarant' },
      ],
      registrations: [
        { registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' },
        { registrationId: 'reg-red-C', personId: 'gp-elsa', personName: 'Elsa' },
      ],
    });
    expect(rows.map((r) => r.kind)).toEqual(['own_bout', 'overlap']);
  });
});

describe('buildRefereeConflictRows — naming', () => {
  /**
   * `detectFighterRefereeConflicts` falls back to the person id, which is a raw
   * UUID. It must never reach a banner.
   *
   * BOTH names have to be the empty string for that branch to be reachable. An
   * earlier version of this test used '  ' on the registration; whitespace is
   * truthy, so the detector stopped one step short and returned the spaces.
   * Deleting the guard still reddened the test — at the wrong branch, proving
   * nothing about the UUID. Hence the pair below: one case per fallback step.
   */
  it('never renders a person id — falls back to the caller label', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: PERSON_UUID, personName: '', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: PERSON_UUID, personName: '' }],
    });
    expect(rows.map((r) => r.personName)).toEqual([UNKNOWN]);
  });

  it('treats a whitespace-only name as no name at all', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: PERSON_UUID, personName: '  ', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: PERSON_UUID, personName: '  ' }],
    });
    expect(rows.map((r) => r.personName)).toEqual([UNKNOWN]);
  });

  it('borrows the name off the registration when the assignment carries none', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: '', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows.map((r) => r.personName)).toEqual(['Denis']);
  });

  it('falls back to the bout number when a bout has no canonical code', () => {
    const rows = build({
      matches: [
        match({ id: 'A', matchNumberLabel: '#12' }),
        match({ id: 'B', matchNumberLabel: '#13', scheduledAt: '2026-06-13T13:02:00Z' }),
      ],
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows.map((r) => [r.fightingLabel, r.refereeingLabel])).toEqual([['#12', '#13']]);
  });
});

describe('buildRefereeConflictRows — id spaces', () => {
  /**
   * The load-bearing assertion. `referee_assignments.person_id` points at
   * `global_persons`; a registration reaches it through
   * `persons.global_person_id`, never `persons.id`. Projecting the wrong one
   * gives a join that matches nothing.
   */
  it('joins on the person id, not the registration id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      // The referee is named by PERSON. Nothing here equals a registration id.
      assignments: [{ matchId: 'B', personId: 'gp-denis', personName: 'Denis', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: 'gp-denis', personName: 'Denis' }],
    });
    expect(rows).toHaveLength(1);
  });

  /**
   * The second half of the same rule, and a live defect in the API until
   * recently: two people nobody could resolve were both keyed under '' and
   * reported as a clash with each other. The payload drops such rows, so the
   * board should never see them — but if one arrives, it must not match a
   * stranger.
   */
  it('does not pair two unresolved people through an empty id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [{ matchId: 'B', personId: '', personName: '', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: '', personName: '' }],
    });
    expect(rows).toEqual([]);
  });

  /** Same rule on the own-bout branch, which joins through the same two ids. */
  it('does not call an unresolved referee the fighter in their own bout', () => {
    const rows = build({
      matches: [match({ id: 'A' })],
      assignments: [{ matchId: 'A', personId: '', personName: '', role: 'declarant' }],
      registrations: [{ registrationId: 'reg-red-A', personId: '', personName: '' }],
    });
    expect(rows).toEqual([]);
  });
});
