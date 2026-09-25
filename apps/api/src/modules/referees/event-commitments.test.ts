import { describe, expect, it } from 'vitest';
import type { AssignmentBoardPool } from './assignment-board.service';
import {
  assignmentTarget,
  availabilityOf,
  buildCommitments,
  slatePools,
  switchesOf,
  unitIndex,
  unitTarget,
  type CommitmentInputs,
} from './event-commitments';

const at = (hhmm: string) => `2026-10-03T${hhmm}:00.000Z`;
const ms = (hhmm: string) => Date.parse(at(hhmm));

function bout(id: string, start: string | null, red: string, blue: string, minutes = 10) {
  return {
    id,
    scheduledAt: start ? at(start) : null,
    durationMinutes: minutes,
    liceId: 'l1',
    redRegistrationId: red,
    blueRegistrationId: blue,
  };
}

function unit(
  over: Partial<AssignmentBoardPool> & Pick<AssignmentBoardPool, 'id' | 'matches'>,
): AssignmentBoardPool {
  const starts = over.matches.map((m) => m.scheduledAt).filter((s): s is string => s !== null);
  return {
    name: over.id,
    tournamentId: 't-ls',
    tournamentName: 'Longsword',
    liceId: 'l1',
    scheduledStart: starts.sort()[0] ?? null,
    scheduledEnd: null,
    kind: 'pool',
    members: [],
    roleSlots: [],
    ...over,
  };
}

// Pool A 10:00–10:20: Léa (reg-lea) v Paul, then Paul v Marc. Léa is on the roster.
const poolA = unit({
  id: 'pool-a',
  name: 'A',
  members: [{ registrationId: 'reg-lea', personId: 'lea', personName: 'Léa', clubLabel: null }],
  matches: [
    bout('a1', '10:00', 'reg-lea', 'reg-paul'),
    bout('a2', '10:10', 'reg-paul', 'reg-marc'),
  ],
});
// Swiss round 3 on two pistes, 10:00 and 10:05.
const swissP1 = unit({
  id: 'swiss-r3-l1',
  name: 'LSW-S3',
  kind: 'swiss',
  swissRoundId: 'r3',
  matchIds: ['s1'],
  members: [],
  matches: [bout('s1', '10:00', 'reg-ann', 'reg-bob')],
});
const swissP2 = unit({
  id: 'swiss-r3-l2',
  name: 'LSW-S3',
  kind: 'swiss',
  swissRoundId: 'r3',
  matchIds: ['s2'],
  members: [],
  matches: [bout('s2', '10:05', 'reg-cat', 'reg-dan')],
});
const final = unit({
  id: 'match-f1',
  name: 'LSW-B-F-M1',
  kind: 'finals',
  matchIds: ['f1'],
  matches: [bout('f1', null, 'reg-ann', 'reg-cat')],
});

const people = new Map([
  ['reg-lea', 'lea'],
  ['reg-paul', 'paul'],
  ['reg-marc', 'marc'],
  ['reg-ann', 'ann'],
  ['reg-bob', 'bob'],
  ['reg-cat', 'cat'],
  ['reg-dan', 'dan'],
]);

const inputs = (over: Partial<CommitmentInputs> = {}): CommitmentInputs => ({
  units: [poolA, swissP1, swissP2, final],
  personIdByRegistration: people,
  assignments: [],
  sessions: [],
  ...over,
});

describe('buildCommitments', () => {
  it('gives each fighter each bout, with its window and its group', () => {
    const fights = buildCommitments(inputs()).filter((c) => c.kind === 'fight');
    expect(fights.find((c) => c.personId === 'lea')).toEqual({
      kind: 'fight',
      personId: 'lea',
      matchId: 'a1',
      groupId: 'pool-a',
      window: { startMs: ms('10:00'), endMs: ms('10:10') },
      label: 'Longsword · A',
    });
    // A Swiss bout's group is its round.
    expect(fights.find((c) => c.personId === 'ann' && c.matchId === 's1')).toMatchObject({
      groupId: 'swiss:r3',
    });
    // An unplaced bracket bout is still a fight, with no window and no group.
    expect(fights.find((c) => c.matchId === 'f1')).toMatchObject({ window: null, groupId: null });
  });

  it('gives each person the hull of every group they fight in, across its units', () => {
    const groups = buildCommitments(inputs()).filter((c) => c.kind === 'fight-pool');
    expect(
      groups
        .filter((c) => c.groupId === 'pool-a')
        .map((c) => c.personId)
        .sort(),
    ).toEqual(['lea', 'marc', 'paul']);
    expect(groups.find((c) => c.groupId === 'pool-a')!.window).toEqual({
      startMs: ms('10:00'),
      endMs: ms('10:20'),
    });
    // Round 3 spans both pistes: 10:00 to 10:15.
    expect(groups.find((c) => c.personId === 'dan')).toEqual({
      kind: 'fight-pool',
      personId: 'dan',
      groupId: 'swiss:r3',
      window: { startMs: ms('10:00'), endMs: ms('10:15') },
      label: 'Longsword · LSW-S3',
    });
  });

  it('counts a roster member with no bout wired yet as in the Pool', () => {
    const early = unit({
      id: 'pool-z',
      members: [{ registrationId: 'reg-zoe', personId: 'zoe', personName: 'Zoé', clubLabel: null }],
      matches: [bout('z1', '12:00', 'reg-x', 'reg-y')],
    });
    const groups = buildCommitments(inputs({ units: [early] })).filter(
      (c) => c.kind === 'fight-pool',
    );
    expect(groups.map((c) => c.personId)).toEqual(['zoe']);
  });

  it('windows a Pool-scoped duty on the hull and a Match-scoped one on its bout', () => {
    const duties = buildCommitments(
      inputs({
        assignments: [
          { id: 'r1', person_id: 'marc', pool_id: 'pool-a', match_id: null, role: 'decl' },
          { id: 'r2', person_id: 'lea', pool_id: null, match_id: 'a2', role: 'table' },
          { id: 'r3', person_id: 'lea', pool_id: null, match_id: 's2', role: 'decl' },
          { id: 'r4', person_id: 'lea', pool_id: null, match_id: 'gone', role: 'decl' },
          { id: 'r5', person_id: 'lea', pool_id: 'pool-a', match_id: null, role: null },
        ],
      }),
    ).filter((c) => c.kind === 'referee');
    expect(duties).toEqual([
      {
        kind: 'referee',
        personId: 'marc',
        unitId: 'pool-a',
        poolId: 'pool-a',
        matchId: null,
        role: 'decl',
        window: { startMs: ms('10:00'), endMs: ms('10:20') },
        label: 'Longsword · A',
      },
      {
        kind: 'referee',
        personId: 'lea',
        unitId: 'pool-a',
        poolId: 'pool-a',
        matchId: 'a2',
        role: 'table',
        window: { startMs: ms('10:10'), endMs: ms('10:20') },
        label: 'Longsword · A',
      },
      {
        kind: 'referee',
        personId: 'lea',
        unitId: 'swiss-r3-l2',
        poolId: null,
        matchId: 's2',
        role: 'decl',
        window: { startMs: ms('10:05'), endMs: ms('10:15') },
        label: 'Longsword · LSW-S3',
      },
    ]);
  });

  it('turns Workshop sessions into teach and attend, untimed ones with no window', () => {
    const sessions = [
      {
        sessionId: 's-cut',
        title: 'Cutting 101',
        startsAt: at('12:00'),
        endsAt: at('13:00'),
        instructorIds: ['marc'],
        attendeeIds: ['lea'],
      },
      {
        sessionId: 's-tbd',
        title: 'Later',
        startsAt: null,
        endsAt: at('15:00'),
        instructorIds: ['paul'],
        attendeeIds: [],
      },
    ];
    const workshop = buildCommitments(inputs({ units: [], sessions }));
    expect(workshop).toEqual([
      {
        kind: 'teach',
        personId: 'marc',
        sessionId: 's-cut',
        window: { startMs: ms('12:00'), endMs: ms('13:00') },
        label: 'Cutting 101',
      },
      {
        kind: 'attend',
        personId: 'lea',
        sessionId: 's-cut',
        window: { startMs: ms('12:00'), endMs: ms('13:00') },
        label: 'Cutting 101',
      },
      { kind: 'teach', personId: 'paul', sessionId: 's-tbd', window: null, label: 'Later' },
    ]);
  });
});

describe('targets', () => {
  const day = (iso: string) => (iso.startsWith('2026-10-03') ? 0 : 1);

  it('a Pool is a Pool-scoped target over its hull', () => {
    expect(unitTarget(poolA, 'decl', day)).toEqual({
      scope: 'pool',
      unitId: 'pool-a',
      poolId: 'pool-a',
      groupId: 'pool-a',
      matchIds: ['a1', 'a2'],
      window: { startMs: ms('10:00'), endMs: ms('10:20') },
      role: 'decl',
      tournamentId: 't-ls',
      dayIndex: 0,
    });
  });

  it('a Swiss unit and a bracket bout are Match-scoped, and an unplaced one has no day', () => {
    expect(unitTarget(swissP1, 'decl', day)).toMatchObject({
      scope: 'match',
      poolId: null,
      groupId: 'swiss:r3',
    });
    expect(unitTarget(final, 'decl', day)).toMatchObject({
      scope: 'match',
      groupId: null,
      window: null,
      dayIndex: null,
    });
  });

  it('a Match-scoped row is judged on its own bout of its unit', () => {
    const row = { id: 'r2', person_id: 'lea', pool_id: null, match_id: 'a2', role: 'table' };
    expect(assignmentTarget(row, poolA, day)).toMatchObject({
      scope: 'match',
      unitId: 'pool-a',
      poolId: 'pool-a',
      matchIds: ['a2'],
      window: { startMs: ms('10:10'), endMs: ms('10:20') },
    });
  });

  it('finds the unit of a Pool row and of a bout row', () => {
    const unitOf = unitIndex([poolA, swissP2]);
    expect(unitOf({ pool_id: 'pool-a', match_id: null })?.id).toBe('pool-a');
    expect(unitOf({ pool_id: null, match_id: 's2' })?.id).toBe('swiss-r3-l2');
    expect(unitOf({ pool_id: null, match_id: 'nope' })).toBeNull();
  });
});

describe('the rest of what the board hands the checker', () => {
  it('maps the settings to the four Discouraged switches', () => {
    expect(
      switchesOf({
        enableOwnPoolRule: true,
        enableOwnPoolSpanRule: false,
        enableTwoRolesRule: true,
        workshopConflictWarning: false,
      }),
    ).toEqual({ ownPool: true, ownPoolSpan: false, twoRoles: true, attendWorkshop: false });
  });

  it('reads availability per person; nobody declared means no restriction', () => {
    const of = availabilityOf([
      { personId: 'lea', availableTournamentIds: ['t-ls'], availableDayIndices: [0] },
    ]);
    expect(of('lea')).toEqual({ tournamentIds: ['t-ls'], dayIndices: [0] });
    expect(of('ghost')).toEqual({ tournamentIds: null, dayIndices: null });
  });

  it('builds the slate from the same units and fighters', () => {
    const [a] = slatePools([{ ...poolA, scheduledEnd: at('10:20') }], people, () => 3);
    expect(a).toEqual({
      id: 'pool-a',
      tournamentId: 't-ls',
      scheduledStart: at('10:00'),
      scheduledEnd: at('10:20'),
      roleSlotCount: 3,
      fighterPersonIds: ['lea', 'paul', 'marc'],
    });
  });
});
