import type { RefereeCommitment } from '@myclash/rulesets/scheduling/referee-checker';
import { describe, expect, it } from 'vitest';
import { instructorBusy } from './instructor-busy';

const TEN = Date.parse('2026-05-21T10:00:00.000Z');
const window = (startMin: number, endMin: number) => ({
  startMs: TEN + startMin * 60_000,
  endMs: TEN + endMin * 60_000,
});
const iso = (min: number) => new Date(TEN + min * 60_000).toISOString();

const paul = 'person-paul';
const marie = 'person-marie';
const instructors = new Set([paul, marie]);

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

    expect(instructorBusy(commitments, instructors)).toEqual([
      { personId: paul, kind: 'fight', label: 'LS · Pool 3', startsAt: iso(0), endsAt: iso(90) },
    ]);
  });

  it('keeps a bracket bout, which belongs to no group, on its own window', () => {
    const commitments: RefereeCommitment[] = [
      {
        kind: 'fight',
        personId: paul,
        matchId: 'f1',
        groupId: null,
        window: window(30, 40),
        label: 'LS · Final',
      },
    ];

    expect(instructorBusy(commitments, instructors)).toEqual([
      { personId: paul, kind: 'fight', label: 'LS · Final', startsAt: iso(30), endsAt: iso(40) },
    ]);
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

    expect(instructorBusy(commitments, instructors)).toEqual([
      { personId: marie, kind: 'referee', label: 'LS · Pool 1', startsAt: iso(0), endsAt: iso(60) },
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

    expect(instructorBusy(commitments, instructors)).toEqual([]);
  });

  it('answers in a stable order: by person, then by start', () => {
    const commitments: RefereeCommitment[] = [
      { kind: 'fight-pool', personId: paul, groupId: 'p2', window: window(60, 90), label: 'B' },
      { kind: 'fight-pool', personId: marie, groupId: 'p1', window: window(0, 30), label: 'A' },
      { kind: 'fight-pool', personId: paul, groupId: 'p1', window: window(0, 30), label: 'A' },
    ];

    expect(instructorBusy(commitments, instructors).map((b) => [b.personId, b.label])).toEqual([
      [marie, 'A'],
      [paul, 'A'],
      [paul, 'B'],
    ]);
  });
});
