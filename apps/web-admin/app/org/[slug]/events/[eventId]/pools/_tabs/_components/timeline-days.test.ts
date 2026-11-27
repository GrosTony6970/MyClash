import { describe, expect, it } from 'vitest';
import { buildTimelineDays } from './timeline-days';

const PARIS = 'Europe/Paris';

function block(startTime: string, id = startTime) {
  return { startTime, pools: [{ id, scheduledStart: startTime }] };
}

function bar(startIso: string, label = startIso) {
  return { startIso, label };
}

describe('buildTimelineDays', () => {
  it('puts an 08:00 Paris bar before a 09:00 Paris timeslot on the same day', () => {
    const days = buildTimelineDays(
      [block('2026-05-22T07:00:00.000Z')], // 09:00 Paris
      [bar('2026-05-22T06:00:00.000Z', 'Registration')], // 08:00 Paris
      PARIS,
    );
    expect(days).toHaveLength(1);
    expect(days[0]!.day).toBe('2026-05-22');
    expect(days[0]!.rows.map((r) => r.kind)).toEqual(['break', 'slot']);
  });

  it('cuts the rows into one group per Event day, in order', () => {
    const days = buildTimelineDays(
      [block('2026-05-23T07:00:00.000Z'), block('2026-05-22T07:00:00.000Z')],
      [bar('2026-05-22T10:00:00.000Z', 'Lunch')],
      PARIS,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-05-22', '2026-05-23']);
    expect(days[0]!.rows.map((r) => r.kind)).toEqual(['slot', 'break']);
    expect(days[1]!.rows.map((r) => r.kind)).toEqual(['slot']);
  });

  it("reads the day on the Event's clock, not UTC", () => {
    // 22:30Z on the 22nd is 00:30 on the 23rd in Paris.
    const days = buildTimelineDays(
      [block('2026-05-22T07:00:00.000Z'), block('2026-05-22T22:30:00.000Z')],
      [],
      PARIS,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-05-22', '2026-05-23']);
  });

  it('answers no days for no rows', () => {
    expect(buildTimelineDays([], [], PARIS)).toEqual([]);
  });
});
