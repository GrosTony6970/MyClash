/**
 * conflict-check.test.ts
 *
 * Tests for the fighter/referee overlap hard constraint.
 */

import { describe, expect, it } from 'vitest';
import { detectFighterRefereeConflicts } from './conflict-check';
import type { RegistrationPersonMap, RefereeAssignment, ScheduledMatch } from './conflict-check';

const BASE_TIME = '2026-06-01T10:00:00.000Z';
const LATER_TIME = '2026-06-01T10:30:00.000Z'; // 30 min later — no overlap with 5-min match

function makeMatch(
  id: string,
  redReg: string,
  blueReg: string,
  scheduledAt: string | null = BASE_TIME,
  durationMinutes = 5,
): ScheduledMatch {
  return {
    id,
    label: id,
    redRegistrationId: redReg,
    blueRegistrationId: blueReg,
    scheduledAt,
    durationMinutes,
  };
}

function makeRef(
  matchId: string,
  personId: string,
  scheduledAt: string | null = BASE_TIME,
  durationMinutes = 5,
): RefereeAssignment {
  return {
    matchId,
    matchLabel: matchId,
    personId,
    personName: `Person ${personId}`,
    role: 'arbitre_declarant',
    scheduledAt,
    durationMinutes,
  };
}

function makeReg(registrationId: string, personId: string): RegistrationPersonMap {
  return { registrationId, personId, personName: `Person ${personId}` };
}

// ── No conflict cases ─────────────────────────────────────────────────────────

describe('no conflicts', () => {
  it('returns empty when no referee assignments', () => {
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b')],
      [],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.hasConfirmedConflicts).toBe(false);
  });

  it('returns empty when referee is not a fighter', () => {
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b')],
      [makeRef('m2', 'person-ref-only')], // person-ref-only has no registration
      [makeReg('reg-a', 'person-1'), makeReg('reg-b', 'person-2')],
    );
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns empty when fighter referees a non-overlapping match', () => {
    // person-1 fights m1 at 10:00, referees m2 at 10:30 (no overlap with 5-min match)
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME)],
      [makeRef('m2', 'person-1', LATER_TIME)],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(0);
  });
});

// ── Confirmed conflicts ───────────────────────────────────────────────────────

describe('confirmed conflicts', () => {
  it('detects fighter refereeing at the same time as their own match', () => {
    // person-1 fights m1 at 10:00, referees m2 also at 10:00
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME)],
      [makeRef('m2', 'person-1', BASE_TIME)],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.personId).toBe('person-1');
    expect(result.conflicts[0]!.confirmed).toBe(true);
    expect(result.hasConfirmedConflicts).toBe(true);
  });

  it('detects overlap when matches partially overlap', () => {
    // m1 starts 10:00, lasts 5 min (ends 10:05)
    // m2 starts 10:03, lasts 5 min (ends 10:08) — overlaps by 2 min
    const overlapTime = '2026-06-01T10:03:00.000Z';
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME, 5)],
      [makeRef('m2', 'person-1', overlapTime, 5)],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.confirmed).toBe(true);
  });

  it('detects blue fighter refereeing conflict', () => {
    // person-2 is the blue fighter in m1, also referees m2 at same time
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME)],
      [makeRef('m2', 'person-2', BASE_TIME)],
      [makeReg('reg-a', 'person-1'), makeReg('reg-b', 'person-2')],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.personId).toBe('person-2');
  });

  it('detects multiple conflicts for same person', () => {
    // person-1 fights m1, referees both m2 and m3 at same time
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME)],
      [makeRef('m2', 'person-1', BASE_TIME), makeRef('m3', 'person-1', BASE_TIME)],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(2);
  });
});

// ── Potential conflicts (unscheduled) ─────────────────────────────────────────

describe('potential conflicts', () => {
  it('flags potential conflict when fight is unscheduled', () => {
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', null)], // unscheduled
      [makeRef('m2', 'person-1', BASE_TIME)],
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.confirmed).toBe(false);
    expect(result.hasPotentialConflicts).toBe(true);
    expect(result.hasConfirmedConflicts).toBe(false);
  });

  it('flags potential conflict when referee slot is unscheduled', () => {
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-b', BASE_TIME)],
      [makeRef('m2', 'person-1', null)], // unscheduled referee slot
      [makeReg('reg-a', 'person-1')],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.confirmed).toBe(false);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('deduplication', () => {
  it('deduplicates same person + same match pair', () => {
    // person-1 is both red and blue fighter (edge case) — should not double-count
    const result = detectFighterRefereeConflicts(
      [makeMatch('m1', 'reg-a', 'reg-a2', BASE_TIME)],
      [makeRef('m2', 'person-1', BASE_TIME)],
      [makeReg('reg-a', 'person-1'), makeReg('reg-a2', 'person-1')],
    );
    // Both registrations map to person-1, but conflict should be deduped
    expect(result.conflicts.length).toBeLessThanOrEqual(1);
  });
});
