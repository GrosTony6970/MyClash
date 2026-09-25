import type { RefereeSwitches } from '@myclash/rulesets/scheduling/referee-checker';
import { describe, expect, it } from 'vitest';
import {
  buildRefereeConflictRows,
  type RefereeConflictAssignment,
  type RefereeConflictMatch,
  type RefereeConflictRegistration,
} from './referee-conflict-rows';

/**
 * The live half of hard rule 8: the cards, turned into commitments, judged by the REAL
 * one checker (ADR-016) — no stub, so these hold the rules as the server applies them.
 *
 * Every fixture keeps the registration id and the person id visibly different (`reg-*`
 * against `gp-*`): keying on `persons.id` instead of `global_persons.id` produces a join
 * that matches nothing — no rows, no error, a board that looks healthy.
 *
 * Times are asserted from a NEW YORK event, not a Paris one. This machine, the app default
 * zone and the drag fixture are all Europe/Paris, so a Paris assertion agrees with a
 * dropped timezone argument and proves nothing.
 */

const TZ = 'America/New_York';
const UNKNOWN = 'Unknown fighter';
/** Shaped like a real id so a leak is obvious. */
const PERSON_UUID = '6f1e9f42-0000-4000-8000-000000000001';
const ALL_ON: RefereeSwitches = {
  ownPool: true,
  ownPoolSpan: true,
  twoRoles: true,
  attendWorkshop: true,
};

function match(over: Partial<RefereeConflictMatch> & { id: string }): RefereeConflictMatch {
  return {
    matchNumberLabel: over.id,
    liceId: 'lice-1',
    scheduledAt: '2026-06-13T13:00:00Z',
    durationMinutes: 5,
    redRegistrationId: `reg-red-${over.id}`,
    blueRegistrationId: `reg-blue-${over.id}`,
    poolId: null,
    poolName: null,
    tournamentName: 'Longsword',
    ...over,
  };
}

/** A Match-scoped duty on `matchId`. */
function onBout(
  matchId: string,
  over: Partial<RefereeConflictAssignment> = {},
): RefereeConflictAssignment {
  return {
    scopeType: 'match',
    matchId,
    poolId: null,
    personId: 'gp-denis',
    personName: 'Denis',
    role: 'declarant',
    confirmedReasons: [],
    ...over,
  };
}

/** A Pool-scoped duty on `poolId`. */
function onPool(
  poolId: string,
  over: Partial<RefereeConflictAssignment> = {},
): RefereeConflictAssignment {
  return onBout('', { scopeType: 'pool', matchId: null, poolId, ...over });
}

const denisIs = (registrationId: string): RefereeConflictRegistration => ({
  registrationId,
  personId: 'gp-denis',
  personName: 'Denis',
});

function build(args: {
  matches: RefereeConflictMatch[];
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
  rules?: RefereeSwitches;
}) {
  return buildRefereeConflictRows({
    rules: ALL_ON,
    ...args,
    tz: TZ,
    unknownPersonLabel: UNKNOWN,
  });
}

const codesOf = (rows: ReturnType<typeof build>) => rows.map((r) => r.reasons.map((x) => x.code));

describe('buildRefereeConflictRows — overlap (Impossible)', () => {
  it('flags a referee whose bout runs into the one they referee', () => {
    const rows = build({
      matches: [
        match({ id: 'A', roundCode: 'LSW-B-M1', scheduledAt: '2026-06-13T13:00:00Z' }),
        match({ id: 'B', roundCode: 'LSW-B-M2', scheduledAt: '2026-06-13T13:02:00Z' }),
      ],
      // Denis fights in A (as red) and referees B, two minutes apart.
      assignments: [onBout('B')],
      registrations: [denisIs('reg-red-A')],
    });
    expect(rows).toEqual([
      {
        key: 'B:gp-denis:declarant',
        personName: 'Denis',
        role: 'declarant',
        refereeingLabel: 'Longsword · LSW-B-M2',
        refereeingTime: '09:02',
        level: 'impossible',
        reasons: [
          {
            code: 'fights_overlap',
            level: 'impossible',
            against: { kind: 'match', id: 'A', label: 'Longsword · LSW-B-M1' },
            confirmed: false,
          },
        ],
      },
    ]);
  });

  it('says nothing when the two bouts only touch (half-open windows)', () => {
    const rows = build({
      matches: [
        match({ id: 'A', scheduledAt: '2026-06-13T13:00:00Z' }),
        match({ id: 'B', scheduledAt: '2026-06-13T13:05:00Z' }),
      ],
      assignments: [onBout('B')],
      registrations: [denisIs('reg-red-A')],
    });
    expect(rows).toEqual([]);
  });

  it('stays silent while either bout is unplaced — no time, or no piste', () => {
    const registrations = [denisIs('reg-red-A')];
    const b = match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' });
    expect(
      build({
        matches: [match({ id: 'A', scheduledAt: null }), b],
        assignments: [onBout('B')],
        registrations,
      }),
    ).toEqual([]);
    expect(
      build({
        matches: [match({ id: 'A', liceId: null }), b],
        assignments: [onBout('B')],
        registrations,
      }),
    ).toEqual([]);
    expect(
      build({
        matches: [match({ id: 'A' }), { ...b, scheduledAt: null }],
        assignments: [onBout('B')],
        registrations,
      }),
    ).toEqual([]);
  });

  it('recomputes from the bouts it is handed — moving one changes the answer', () => {
    const args = {
      assignments: [onBout('B')],
      registrations: [denisIs('reg-red-A')],
    };
    const a = match({ id: 'A', scheduledAt: '2026-06-13T13:00:00Z' });
    expect(
      build({ ...args, matches: [a, match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })] }),
    ).toHaveLength(1);
    expect(
      build({ ...args, matches: [a, match({ id: 'B', scheduledAt: '2026-06-13T14:00:00Z' })] }),
    ).toEqual([]);
  });

  it('reads the blue corner as well as the red', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('B')],
      registrations: [denisIs('reg-blue-A')],
    });
    expect(codesOf(rows)).toEqual([['fights_overlap']]);
  });

  it('flags two duties at once, and ignores a duty whose bout the board is not holding', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('A', { role: 'table' }), onBout('B'), onBout('gone')],
      registrations: [],
    });
    expect(codesOf(rows)).toEqual([['referees_overlap'], ['referees_overlap']]);
  });

  it('leaves a referee who fights nowhere alone', () => {
    const rows = build({
      matches: [match({ id: 'A' })],
      assignments: [onBout('A')],
      registrations: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('buildRefereeConflictRows — own bout (Impossible)', () => {
  it('flags a referee on the very bout they fight in, placed or not, once', () => {
    const placed = build({
      matches: [match({ id: 'A', roundCode: 'LSW-B-M1' })],
      assignments: [onBout('A'), onBout('A', { role: 'table' })],
      registrations: [denisIs('reg-red-A')],
    });
    // Two roles on one bout is also two roles (Discouraged); own_match makes it red.
    expect(codesOf(placed)).toEqual([
      ['own_match', 'two_roles'],
      ['own_match', 'two_roles'],
    ]);
    expect(placed.map((r) => r.level)).toEqual(['impossible', 'impossible']);
    const unplaced = build({
      matches: [match({ id: 'A', scheduledAt: null, liceId: null })],
      assignments: [onBout('A')],
      registrations: [denisIs('reg-red-A')],
    });
    expect(unplaced).toEqual([
      expect.objectContaining({
        refereeingTime: '',
        level: 'impossible',
        reasons: [expect.objectContaining({ code: 'own_match' })],
      }),
    ]);
  });
});

describe('buildRefereeConflictRows — Pools', () => {
  // Pool 1: bouts P1a 13:00 and P1b 13:10. Pool 2: bout P2a 13:05, in the gap between
  // Pool 1's two bouts and touching both: only Pool 1's HULL overlaps it, never one card.
  const pool1 = [
    match({ id: 'P1a', poolId: 'p1', poolName: 'Pool 1', scheduledAt: '2026-06-13T13:00:00Z' }),
    match({ id: 'P1b', poolId: 'p1', poolName: 'Pool 1', scheduledAt: '2026-06-13T13:10:00Z' }),
  ];
  const pool2 = [
    match({ id: 'P2a', poolId: 'p2', poolName: 'Pool 2', scheduledAt: '2026-06-13T13:05:00Z' }),
  ];

  it("hulls a Pool-scoped crew from the Pool's placed cards (the case a bout-only read missed)", () => {
    // Denis fights P2a at 13:05 and crews Pool 1 (13:00–13:15).
    const rows = build({
      matches: [...pool1, ...pool2],
      assignments: [onPool('p1')],
      registrations: [denisIs('reg-red-P2a')],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'p1:gp-denis:declarant',
        refereeingLabel: 'Longsword · Pool 1',
        refereeingTime: '09:00',
        level: 'impossible',
        reasons: [
          expect.objectContaining({
            code: 'fights_overlap',
            against: expect.objectContaining({ id: 'P2a' }),
          }),
        ],
      }),
    ]);
  });

  it('calls crewing his own Pool Discouraged, and the switch turns it off', () => {
    const args = {
      matches: pool1,
      assignments: [onPool('p1')],
      registrations: [denisIs('reg-red-P1a')],
    };
    expect(build(args)).toEqual([
      expect.objectContaining({
        level: 'discouraged',
        reasons: [
          expect.objectContaining({
            code: 'own_pool',
            against: expect.objectContaining({ label: 'Longsword · Pool 1' }),
          }),
        ],
      }),
    ]);
    expect(build({ ...args, rules: { ...ALL_ON, ownPool: false } })).toEqual([]);
  });

  it('calls refereeing while his own Pool runs Discouraged when none of his bouts clash (ruling 5)', () => {
    // Denis fights P1b at 13:10 in Pool 1 (13:00–13:15); asked to referee P2a at 13:05.
    const args = {
      matches: [...pool1, ...pool2],
      assignments: [onBout('P2a')],
      registrations: [denisIs('reg-red-P1b')],
    };
    expect(codesOf(build(args))).toEqual([['own_pool_span']]);
    expect(build({ ...args, rules: { ...ALL_ON, ownPoolSpan: false } })).toEqual([]);
  });

  it('merges a per-Pool crew written one row per bout into one row, and grades two roles', () => {
    const rows = build({
      matches: pool1,
      assignments: [onBout('P1a'), onBout('P1b'), onPool('p1', { role: 'table' })],
      registrations: [],
    });
    expect(rows.map((r) => [r.key, r.reasons.map((x) => x.code)])).toEqual([
      ['p1:gp-denis:declarant', ['two_roles']],
      ['p1:gp-denis:table', ['two_roles']],
    ]);
  });

  it('shows a reason the organiser confirmed over as confirmed, and not a warning (ruling 135)', () => {
    const rows = build({
      matches: pool1,
      assignments: [
        onPool('p1', { confirmedReasons: [{ code: 'own_pool', label: 'Longsword · Pool 1' }] }),
      ],
      registrations: [denisIs('reg-red-P1a')],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        level: 'fine',
        reasons: [expect.objectContaining({ code: 'own_pool', confirmed: true })],
      }),
    ]);
  });
});

describe('buildRefereeConflictRows — Swiss rounds', () => {
  // No round on the board's bouts: a Swiss bout is judged as a bout (group rules: server half).
  const s1 = match({ id: 'S1', roundCode: 'LSW-S3-M1', scheduledAt: '2026-06-13T13:00:00Z' });
  const s2 = match({ id: 'S2', roundCode: 'LSW-S3-M2', liceId: 'lice-2' });
  const refereeingS1 = { assignments: [onBout('S1')], registrations: [denisIs('reg-red-S2')] };

  it('flags a bout of the round on another piste at the same time', () => {
    expect(codesOf(build({ matches: [s1, s2], ...refereeingS1 }))).toEqual([['fights_overlap']]);
  });

  it('says nothing about the round at another time (no group on the board)', () => {
    const later = { ...s2, scheduledAt: '2026-06-13T13:20:00Z' };
    expect(build({ matches: [s1, later], ...refereeingS1 })).toEqual([]);
  });
});

describe('buildRefereeConflictRows — naming', () => {
  const clash = (
    assignment: RefereeConflictAssignment,
    registrations: RefereeConflictRegistration[],
  ) =>
    build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [assignment],
      registrations,
    });

  it('never renders a person id — falls back to the caller label', () => {
    const rows = clash(onBout('B', { personId: PERSON_UUID, personName: '' }), [
      { registrationId: 'reg-red-A', personId: PERSON_UUID, personName: '' },
    ]);
    expect(rows[0]!.personName).toBe(UNKNOWN);
    expect(JSON.stringify(rows.map((r) => r.personName))).not.toContain(PERSON_UUID);
  });

  it('treats a whitespace-only name as no name, and borrows the registration name', () => {
    const rows = clash(onBout('B', { personName: '   ' }), [denisIs('reg-red-A')]);
    expect(rows[0]!.personName).toBe('Denis');
  });

  it('falls back to the bout number when a bout has no canonical code', () => {
    const rows = clash(onBout('B'), [denisIs('reg-red-A')]);
    expect(rows[0]!.refereeingLabel).toBe('Longsword · B');
  });
});

describe('buildRefereeConflictRows — id spaces', () => {
  it('joins on the person id, not the registration id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('B', { personId: 'reg-red-A' })],
      registrations: [denisIs('reg-red-A')],
    });
    expect(rows).toEqual([]);
  });

  it('does not pair two unresolved people through an empty id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('B', { personId: '' })],
      registrations: [{ registrationId: 'reg-red-A', personId: '', personName: '' }],
    });
    expect(rows).toEqual([]);
  });
});
