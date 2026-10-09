import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayChipLabel, dayHeading, eventDay, eventDays, onEventDay } from './schedule-days';

/**
 * The guest schedule's days (quick win F2). A bout at 00:30 in Paris on Sunday
 * is 23:30 UTC on Saturday. The page offered a "Sunday" chip from the Event's
 * clock, then filtered on the UTC text of the time: the chip hid its own bout.
 */
const PARIS = 'Europe/Paris';
const SATURDAY_NOON = '2027-03-13T11:00:00.000Z';
/** 00:30 on Sunday in Paris. */
const AFTER_MIDNIGHT = '2027-03-13T23:30:00.000Z';
const item = (time: string | null) => ({ time });

describe('eventDay', () => {
  it("is the day on the Event's clock, not the UTC day", () => {
    expect(eventDay(SATURDAY_NOON, PARIS)).toBe('2027-03-13');
    expect(eventDay(AFTER_MIDNIGHT, PARIS)).toBe('2027-03-14');
  });

  it("is the Event's day west of UTC too", () => {
    // 01:00 UTC on Sunday is 20:00 on Saturday in New York.
    expect(eventDay('2027-03-14T01:00:00.000Z', 'America/New_York')).toBe('2027-03-13');
  });

  it('falls back on the text of a time it cannot place', () => {
    expect(eventDay('2027-03-13T11:00:00.000Z', 'Not/AZone')).toBe('2027-03-13');
  });
});

describe('eventDays', () => {
  it('lists each day once, in order, and skips an item with no time', () => {
    const items = [item(AFTER_MIDNIGHT), item(null), item(SATURDAY_NOON), item(SATURDAY_NOON)];
    expect(eventDays(items, PARIS)).toEqual(['2027-03-13', '2027-03-14']);
  });
});

describe('onEventDay', () => {
  const items = [item(SATURDAY_NOON), item(AFTER_MIDNIGHT), item(null)];

  it('keeps everything for "all"', () => {
    expect(onEventDay(items, 'all', PARIS)).toEqual(items);
  });

  it('keeps the bout after midnight under the day its chip names', () => {
    expect(onEventDay(items, '2027-03-14', PARIS)).toEqual([item(AFTER_MIDNIGHT)]);
    expect(onEventDay(items, '2027-03-13', PARIS)).toEqual([item(SATURDAY_NOON)]);
  });

  it('every day the chips offer holds at least one item', () => {
    for (const day of eventDays(items, PARIS)) {
      expect(onEventDay(items, day, PARIS).length).toBeGreaterThan(0);
    }
  });
});

describe('the words for a day', () => {
  // A day is a date, not an instant: its words do not depend on where the phone
  // is. This phone is in New York, where midnight UTC is still the day before.
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names the day of the key on the chip', () => {
    expect(dayChipLabel('2027-03-14', 'en')).toBe('Sun 14');
    expect(dayChipLabel('2027-03-14', 'fr')).toBe('dim. 14');
  });

  it('names the day of the key in the heading', () => {
    expect(dayHeading('2027-03-14', 'en')).toBe('Sunday 14 March');
    expect(dayHeading('2027-03-14', 'fr')).toBe('dimanche 14 mars');
  });
});
