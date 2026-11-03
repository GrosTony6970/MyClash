import { zonedToUtcIso } from '@myclash/time';
import { describe, expect, it } from 'vitest';
import { planBlockMove, planDayDelay, type MoveCandidateMatch } from './block-move-plan';

/**
 * A bout's day and hour are read on the EVENT's clock, the clock its bar's "HH:MM" is on, never
 * the server's. The Events here are in zones no test run uses (New York, Tokyo), so a planner
 * that read the run's clock goes red under every run zone (`reference_paris_timezone_blind_spot`).
 * 2026-11-07 is a winter day in both: New York is UTC-5, Tokyo UTC+9.
 */
const DAY = '2026-11-07';
const NEW_YORK = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

const bout = (id: string, scheduledAt: string | null, label: string | null = null) =>
  ({ id, scheduledAt, status: 'scheduled', label }) satisfies MoveCandidateMatch;

/** Bar "Lunch" 12:00-13:00 of a New York Event, dragged to 14:00. */
function lunchMoved(matches: MoveCandidateMatch[]) {
  return planBlockMove({
    movedBlockId: 'lunch',
    movedBlockLabel: 'Lunch',
    deltaMin: 120,
    oldStartMin: 12 * 60,
    blockDateIso: DAY,
    zone: NEW_YORK,
    dayBlocks: [{ id: 'lunch', label: 'Lunch', startMin: 12 * 60, endMin: 13 * 60 }],
    matches,
  });
}

describe('planBlockMove on the Event clock', () => {
  it('leaves an 11:00 New York bout before the bar where it is', () => {
    // 16:00Z: 17:00 on a Paris clock and 16:00 on a UTC one, both after the 12:00 cut.
    const plan = lunchMoved([bout('before', '2026-11-07T16:00:00.000Z')]);

    expect(plan.refusal).toBeNull();
    expect(plan.matchShifts).toEqual([]);
  });

  it('moves a 12:30 New York bout to 14:30 New York', () => {
    const plan = lunchMoved([bout('after', zonedToUtcIso(DAY, '12:30', NEW_YORK))]);

    expect(plan.matchShifts).toEqual([
      { id: 'after', scheduledAt: zonedToUtcIso(DAY, '14:30', NEW_YORK) },
    ]);
  });

  it('refuses a drag that would carry a 23:00 New York bout past its midnight, in New York times', () => {
    // 04:00Z on 11-08: another day on a Paris or a UTC clock, so a server-clock read skips it.
    const plan = lunchMoved([bout('late', '2026-11-08T04:00:00.000Z', 'LSW-F')]);

    expect(plan.matchShifts).toEqual([]);
    expect(plan.refusal).toBe(
      'Moving "Lunch" by +120 min would carry the fight LSW-F past midnight ' +
        '(23:00 becomes 01:00). Nothing was moved.',
    );
  });

  it('skips a bout whose time cannot be read', () => {
    const plan = lunchMoved([bout('garbled', 'not a time')]);

    expect(plan.refusal).toBeNull();
    expect(plan.matchShifts).toEqual([]);
  });
});

describe('planDayDelay on the Event clock', () => {
  it('pushes back an 08:30 Tokyo bout when the day runs late from 08:00', () => {
    // 23:30Z on 11-06: 00:30 the same day on a Paris clock (before the cut), the day before on
    // a UTC one.
    const plan = planDayDelay({
      deltaMin: 30,
      fromMin: 8 * 60,
      blockDateIso: DAY,
      zone: TOKYO,
      dayBlocks: [],
      matches: [bout('morning', '2026-11-06T23:30:00.000Z')],
    });

    expect(plan.refusal).toBeNull();
    expect(plan.matchShifts).toEqual([{ id: 'morning', scheduledAt: '2026-11-07T00:00:00.000Z' }]);
  });
});
