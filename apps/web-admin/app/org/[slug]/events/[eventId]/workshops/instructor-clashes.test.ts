import { describe, expect, it } from 'vitest';
import type { WorkshopInstructorBusy } from '@myclash/types';
import { instructorClashes, instructorKey, type ClashWorkshop } from './instructor-clashes';

const PAUL = { globalPersonId: 'gp-paul', displayName: 'Paul' };
const MARIE = { globalPersonId: 'gp-marie', displayName: 'Marie' };
const at = (hhmm: string) => `2026-05-23T${hhmm}:00.000Z`;

function workshop(
  title: string,
  instructors: ClashWorkshop['instructors'],
  sessions: Array<[id: string, start: string | null, end: string | null, status?: string]>,
): ClashWorkshop {
  return {
    title,
    instructors,
    sessions: sessions.map(([id, start, end, status]) => ({
      id,
      startsAt: start && at(start),
      endsAt: end && at(end),
      status: status ?? 'scheduled',
    })),
  };
}

function busy(over: Partial<WorkshopInstructorBusy>): WorkshopInstructorBusy {
  return {
    personId: PAUL.globalPersonId,
    kind: 'referee',
    label: 'Longsword Open · Pool 3',
    startsAt: at('10:00'),
    endsAt: at('11:30'),
    ...over,
  };
}

describe('instructorClashes (rulings 553-555)', () => {
  it('flags both sessions when one person teaches two Workshops at once, each naming the other', () => {
    const clashes = instructorClashes(
      [
        workshop('Longsword basics', [PAUL], [['s-ls', '10:00', '11:00']]),
        workshop('Dagger intro', [PAUL], [['s-dg', '10:30', '11:30']]),
      ],
      [],
    );

    expect(clashes.get('s-ls')).toEqual([
      { name: 'Paul', kind: 'teaches', against: 'Dagger intro' },
    ]);
    expect(clashes.get('s-dg')).toEqual([
      { name: 'Paul', kind: 'teaches', against: 'Longsword basics' },
    ]);
  });

  it('flags nothing when the sessions only touch, or share no person', () => {
    expect(
      instructorClashes(
        [
          workshop('Longsword basics', [PAUL], [['s-ls', '10:00', '11:00']]),
          workshop('Dagger intro', [PAUL], [['s-dg', '11:00', '12:00']]),
          workshop('Rapier', [MARIE], [['s-rp', '10:00', '11:00']]),
        ],
        [],
      ).size,
    ).toBe(0);
  });

  it('flags two sessions of the same Workshop at once, even with two instructors (555)', () => {
    const clashes = instructorClashes(
      [
        workshop(
          'Longsword basics',
          [PAUL, MARIE],
          [
            ['s-a', '10:00', '11:00'],
            ['s-b', '10:00', '11:00'],
          ],
        ),
      ],
      [],
    );

    expect(clashes.get('s-a')).toEqual([
      { name: 'Paul', kind: 'teaches', against: 'Longsword basics' },
      { name: 'Marie', kind: 'teaches', against: 'Longsword basics' },
    ]);
    expect(clashes.get('s-b')).toHaveLength(2);
  });

  it('leaves out a cancelled session, a session with no end, and an instructor with no person', () => {
    const clashes = instructorClashes(
      [
        workshop('Longsword basics', [PAUL], [['s-ls', '10:00', '11:00']]),
        workshop('Dagger intro', [PAUL], [['s-dg', '10:30', '11:30', 'cancelled']]),
        workshop('Rapier', [PAUL], [['s-rp', '10:30', null]]),
        workshop(
          'Sabre',
          [{ globalPersonId: null, displayName: 'Paul' }],
          [['s-sb', '10:00', '11:00']],
        ),
      ],
      [],
    );

    expect(clashes.size).toBe(0);
  });

  it('flags a session whose instructor referees or fights then, with the unit', () => {
    const clashes = instructorClashes(
      [workshop('Dagger intro', [PAUL], [['s-dg', '10:30', '11:30']])],
      [
        busy({}),
        busy({
          kind: 'fight',
          label: 'Sabre Open · Pool 1',
          startsAt: at('11:00'),
          endsAt: at('12:00'),
        }),
      ],
    );

    expect(clashes.get('s-dg')).toEqual([
      { name: 'Paul', kind: 'referees', against: 'Longsword Open · Pool 3' },
      { name: 'Paul', kind: 'fights', against: 'Sabre Open · Pool 1' },
    ]);
  });

  it("ignores another person's busy time, and a busy time that only touches", () => {
    const clashes = instructorClashes(
      [workshop('Dagger intro', [PAUL], [['s-dg', '11:30', '12:30']])],
      [
        busy({}),
        busy({ personId: MARIE.globalPersonId, startsAt: at('12:00'), endsAt: at('13:00') }),
      ],
    );

    expect(clashes.size).toBe(0);
  });

  it('says a reason once when three duty rows of one Swiss crew overlap the session', () => {
    const clashes = instructorClashes(
      [workshop('Dagger intro', [PAUL], [['s-dg', '10:00', '11:00']])],
      [
        busy({ label: 'LS · S3', startsAt: at('10:00'), endsAt: at('10:10') }),
        busy({ label: 'LS · S3', startsAt: at('10:10'), endsAt: at('10:20') }),
        busy({ label: 'LS · S3', startsAt: at('10:20'), endsAt: at('10:30') }),
      ],
    );

    expect(clashes.get('s-dg')).toEqual([{ name: 'Paul', kind: 'referees', against: 'LS · S3' }]);
  });
});

describe('instructorKey', () => {
  it('changes when an instructor is added, not when the order changes', () => {
    const one = [workshop('A', [PAUL, MARIE], []), workshop('B', [PAUL], [])];
    const reordered = [workshop('B', [PAUL], []), workshop('A', [MARIE, PAUL], [])];
    const fewer = [workshop('A', [PAUL], [])];

    expect(instructorKey(one)).toBe(instructorKey(reordered));
    expect(instructorKey(fewer)).not.toBe(instructorKey(one));
  });
});
