import type { RefereeCommitment } from '@myclash/rulesets/scheduling/referee-checker';
import { describe, expect, it } from 'vitest';
import type { AssignmentBoardPool } from './assignment-board.service';
import { eliminationBoutIds, instructorBusy, type BoutResult } from './instructor-busy';

const TEN = Date.parse('2026-05-21T10:00:00.000Z');
const window = (startMin: number, endMin: number) => ({
  startMs: TEN + startMin * 60_000,
  endMs: TEN + endMin * 60_000,
});
const iso = (min: number) => new Date(TEN + min * 60_000).toISOString();

const paul = 'person-paul';
const marie = 'person-marie';
const instructors = new Set([paul, marie]);

/** Commitments alone: no Swiss phase, no bracket. */
const only = (commitments: RefereeCommitment[]) =>
  instructorBusy({
    commitments,
    units: [],
    personIdByRegistration: new Map(),
    instructorIds: instructors,
    results: new Map(),
  });

describe('instructorBusy (rulings 553-555)', () => {
  it("keeps a Pool's span, and drops the Pool's own bouts inside it", () => {
    const commitments: RefereeCommitment[] = [
      {
        kind: 'fight-pool',
        personId: paul,
        groupId: 'pool-3',
        window: window(0, 90),
        label: 'LS · Pool 3',
      },
      {
        kind: 'fight',
        personId: paul,
        matchId: 'm1',
        groupId: 'pool-3',
        window: window(10, 15),
        label: 'LS · Pool 3',
      },
    ];

    expect(only(commitments)).toEqual([
      {
        personId: paul,
        kind: 'fight',
        block: null,
        label: 'LS · Pool 3',
        startsAt: iso(0),
        endsAt: iso(90),
      },
    ]);
  });

  it("drops a bracket bout and a Swiss round from the checker's list: they come as blocks", () => {
    const commitments: RefereeCommitment[] = [
      {
        kind: 'fight',
        personId: paul,
        matchId: 'f1',
        groupId: null,
        window: window(30, 40),
        label: 'LS · Final',
      },
      {
        kind: 'fight-pool',
        personId: paul,
        groupId: 'swiss:round-1',
        window: window(0, 30),
        label: 'LS · Swiss 1',
      },
    ];

    expect(only(commitments)).toEqual([]);
  });

  it('keeps a referee duty', () => {
    const commitments: RefereeCommitment[] = [
      {
        kind: 'referee',
        personId: marie,
        unitId: 'pool-1',
        poolId: 'pool-1',
        matchId: null,
        role: 'arbitre_declarant',
        matchIds: [],
        slot: 0,
        day: '2026-05-21',
        window: window(0, 60),
        label: 'LS · Pool 1',
      },
    ];

    expect(only(commitments)).toEqual([
      {
        personId: marie,
        kind: 'referee',
        block: null,
        label: 'LS · Pool 1',
        startsAt: iso(0),
        endsAt: iso(60),
      },
    ]);
  });

  it('leaves out a non-instructor, an untimed commitment, teaching and attending', () => {
    const commitments: RefereeCommitment[] = [
      {
        kind: 'fight-pool',
        personId: 'person-stranger',
        groupId: 'pool-3',
        window: window(0, 90),
        label: 'LS · Pool 3',
      },
      { kind: 'fight-pool', personId: paul, groupId: 'pool-4', window: null, label: 'LS · Pool 4' },
      {
        kind: 'teach',
        personId: paul,
        sessionId: 's1',
        window: window(0, 60),
        label: 'Dagger intro',
      },
      { kind: 'attend', personId: marie, sessionId: 's2', window: window(0, 60), label: 'Rapier' },
    ];

    expect(only(commitments)).toEqual([]);
  });

  it('answers in a stable order: by person, then by start', () => {
    const commitments: RefereeCommitment[] = [
      { kind: 'fight-pool', personId: paul, groupId: 'p2', window: window(60, 90), label: 'B' },
      { kind: 'fight-pool', personId: marie, groupId: 'p1', window: window(0, 30), label: 'A' },
      { kind: 'fight-pool', personId: paul, groupId: 'p1', window: window(0, 30), label: 'A' },
    ];

    expect(only(commitments).map((b) => [b.personId, b.label])).toEqual([
      [marie, 'A'],
      [paul, 'A'],
      [paul, 'B'],
    ]);
  });
});

/**
 * Paul teaches at 15:00 and fights in the Longsword bracket (operator, 2026-11-23): he is busy from
 * the bracket's first bout, at 10:00, whoever fights it, until he is out; still in, to its end.
 * The bracket: a quarter-final he fights at 10:30, a semi at 11:00, the Final at 12:00, ten
 * minutes each. Marie fights in the Swiss phase: rounds at 10:00 and 11:00, busy for both and
 * between them.
 */
const bout = (
  id: string,
  min: number,
  red: string | null,
  blue: string | null,
): AssignmentBoardPool['matches'][number] => ({
  id,
  scheduledAt: iso(min),
  durationMinutes: 10,
  liceId: null,
  redRegistrationId: red,
  blueRegistrationId: blue,
});
const unit = (
  id: string,
  kind: AssignmentBoardPool['kind'],
  matches: AssignmentBoardPool['matches'],
): AssignmentBoardPool =>
  ({
    id,
    name: id,
    tournamentId: 't-ls',
    tournamentName: 'Longsword Open',
    kind,
    matches,
    members: [],
  }) as unknown as AssignmentBoardPool;

const UNITS = [
  unit('r1', 'bracket', [bout('first', 0, 'reg-x', 'reg-y')]),
  unit('qf', 'bracket', [bout('qf', 30, 'reg-paul', 'reg-z')]),
  unit('sf', 'bracket', [bout('sf', 60, null, null)]),
  unit('final', 'finals', [bout('final', 120, null, null)]),
  unit('sw1', 'swiss', [bout('sw1', 0, 'reg-marie', 'reg-w')]),
  unit('sw2', 'swiss', [bout('sw2', 60, 'reg-v', 'reg-marie')]),
];
const PEOPLE = new Map([
  ['reg-paul', paul],
  ['reg-marie', marie],
  ['reg-z', 'person-stranger'],
]);

const busyWith = (results: Map<string, BoutResult>) =>
  instructorBusy({
    commitments: [],
    units: UNITS,
    personIdByRegistration: PEOPLE,
    instructorIds: instructors,
    results,
  });

describe('instructorBusy — a bracket and a Swiss phase are one block each (2026-11-23)', () => {
  it('holds him from the bracket start to its end while he is still in', () => {
    const paulsBlock = busyWith(new Map()).find((entry) => entry.personId === paul);

    expect(paulsBlock).toEqual({
      personId: paul,
      kind: 'fight',
      block: 'elimination',
      label: 'Longsword Open',
      startsAt: iso(0),
      endsAt: iso(130),
    });
  });

  it('frees him at the end of the bout he lost', () => {
    const lost = new Map([['qf', { status: 'completed', winnerRegistrationId: 'reg-z' }]]);

    expect(busyWith(lost).find((entry) => entry.personId === paul)?.endsAt).toBe(iso(40));
  });

  it('keeps him to the end once he won', () => {
    const won = new Map([['qf', { status: 'completed', winnerRegistrationId: 'reg-paul' }]]);

    expect(busyWith(won).find((entry) => entry.personId === paul)?.endsAt).toBe(iso(130));
  });

  it('holds a Swiss fighter for the whole Swiss phase, between rounds too', () => {
    expect(busyWith(new Map()).find((entry) => entry.personId === marie)).toEqual({
      personId: marie,
      kind: 'fight',
      block: 'swiss',
      label: 'Longsword Open',
      startsAt: iso(0),
      endsAt: iso(70),
    });
  });

  it('asks the results of the instructors’ own bracket bouts only', () => {
    expect(eliminationBoutIds(UNITS, PEOPLE, instructors)).toEqual(['qf']);
  });
});
