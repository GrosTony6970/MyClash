import { describe, it, expect } from 'vitest';
import { detectConflicts, type ScheduleMatchForConflict } from './conflict-detection';

const TZ = 'Europe/Paris';
const UNKNOWN = 'Unknown fighter';

function buildMatch(over: Partial<ScheduleMatchForConflict>): ScheduleMatchForConflict {
  return {
    matchNumberLabel: 'M?',
    liceId: 'lice-1',
    scheduledAt: '2026-05-29T10:30:00.000Z',
    durationMinutes: 10,
    redRegistrationId: 'reg-red',
    blueRegistrationId: 'reg-blue',
    redFighterName: 'Red Fighter',
    blueFighterName: 'Blue Fighter',
    ...over,
  };
}

describe('detectConflicts', () => {
  it('resolves the fighter name from another match when the offending match has it null', () => {
    // The exact prod repro: a bracket match A is double-booked with a
    // pool match B at 10:30. The bracket match doesn't carry the
    // fighter's name (its red/blueFighterName columns are null), but
    // the pool match does. The conflict line MUST render the name,
    // never the registration UUID.
    const matchA = buildMatch({
      matchNumberLabel: '2',
      redRegistrationId: 'reg-shared',
      redFighterName: null,
      blueFighterName: null,
    });
    const matchB = buildMatch({
      matchNumberLabel: 'L1-PA-M2',
      redRegistrationId: 'reg-shared',
      redFighterName: 'Alice Smith',
      blueFighterName: 'Bob Jones',
    });

    const conflicts = detectConflicts([matchA, matchB], TZ, UNKNOWN);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.personName).toBe('Alice Smith');
  });

  it('resolves the fighter name from the same match when present (happy path)', () => {
    const matchA = buildMatch({
      matchNumberLabel: 'L1-PA-M1',
      redRegistrationId: 'reg-shared',
      redFighterName: 'Alice Smith',
    });
    const matchB = buildMatch({
      matchNumberLabel: 'L1-PA-M2',
      redRegistrationId: 'reg-shared',
      redFighterName: 'Alice Smith',
    });

    const conflicts = detectConflicts([matchA, matchB], TZ, UNKNOWN);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.personName).toBe('Alice Smith');
  });

  it("never renders a registration UUID — falls back to 'Unknown fighter' when no match carries the name", () => {
    // Lock the "No raw IDs in UI" rule. If somehow the schedule has a
    // double-booking but NO match in the schedule carries the
    // fighter's name (genuinely orphaned data — should be impossible
    // in practice), we render a generic placeholder rather than the
    // UUID. The conflict still surfaces so the operator sees it.
    const matchA = buildMatch({
      matchNumberLabel: 'L1-PA-M1',
      redRegistrationId: 'reg-shared',
      redFighterName: null,
      blueFighterName: null,
    });
    const matchB = buildMatch({
      matchNumberLabel: 'L1-PA-M2',
      redRegistrationId: 'reg-shared',
      redFighterName: null,
      blueFighterName: null,
    });

    const conflicts = detectConflicts([matchA, matchB], TZ, UNKNOWN);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.personName).toBe(UNKNOWN);
    // Defensive: explicitly confirm the UUID never leaks.
    expect(conflicts[0]?.personName).not.toBe('reg-shared');
  });

  it('renders the conflict time in strict 24h HH:MM, never AM/PM', () => {
    // Per operator request: unify time display to 24h across the
    // schedule page. The conflict banner is one site; locking the
    // shape here protects against any locale or browser that would
    // otherwise hand us "10:30 AM".
    const matchA = buildMatch({
      matchNumberLabel: 'L1-PA-M1',
      scheduledAt: '2026-05-29T15:45:00.000Z',
      redRegistrationId: 'reg-shared',
    });
    const matchB = buildMatch({
      matchNumberLabel: 'L1-PA-M2',
      scheduledAt: '2026-05-29T15:45:00.000Z',
      redRegistrationId: 'reg-shared',
    });

    const conflicts = detectConflicts([matchA, matchB], TZ, UNKNOWN);

    expect(conflicts).toHaveLength(1);
    // 24h shape: two digits, colon, two digits. No AM/PM marker.
    expect(conflicts[0]?.time).toMatch(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
    expect(conflicts[0]?.time?.toUpperCase()).not.toContain('AM');
    expect(conflicts[0]?.time?.toUpperCase()).not.toContain('PM');
  });

  /**
   * The banner used to build its time with `Date#getHours`, which reads the
   * VIEWER's zone. Detection itself was never wrong — the overlap test is
   * epoch arithmetic — but the time an organiser was told to go and fix was.
   * These assert an absolute instant against a named zone, so they mean the
   * same thing on every machine and would have failed on the old code
   * regardless of where CI runs.
   */
  it("renders the time on the event wall clock, not the viewer's", () => {
    // 07:00Z is 09:00 in Paris (CEST, UTC+2) and 03:00 in New York.
    const at = '2026-05-29T07:00:00.000Z';
    const conflicts = detectConflicts(
      [
        buildMatch({ matchNumberLabel: 'M1', scheduledAt: at, redRegistrationId: 'reg-shared' }),
        buildMatch({ matchNumberLabel: 'M2', scheduledAt: at, redRegistrationId: 'reg-shared' }),
      ],
      'Europe/Paris',
      UNKNOWN,
    );

    expect(conflicts[0]?.time).toBe('09:00');
  });

  it('follows the event zone rather than a fixed offset', () => {
    const at = '2026-05-29T07:00:00.000Z';
    const conflicts = detectConflicts(
      [
        buildMatch({ matchNumberLabel: 'M1', scheduledAt: at, redRegistrationId: 'reg-shared' }),
        buildMatch({ matchNumberLabel: 'M2', scheduledAt: at, redRegistrationId: 'reg-shared' }),
      ],
      'America/New_York',
      UNKNOWN,
    );

    expect(conflicts[0]?.time).toBe('03:00');
  });
});
