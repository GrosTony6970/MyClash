import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDayShort, slotHeading } from './day-label';

/**
 * The referee board's day pills name the Event's dates. A pill's date is bare, so it was
 * read on the machine's clock: an organiser in Montreal saw Saturday's pill say Friday.
 */

const machine = process.env.TZ;
afterEach(() => {
  process.env.TZ = machine;
});

describe('formatDayShort', () => {
  it('names a pill by its own date on a clock west of UTC', () => {
    process.env.TZ = 'America/New_York';
    expect(formatDayShort('2027-06-05', 'en', 'UTC')).toBe('Sat 05/06');
    expect(formatDayShort('2027-06-05', 'fr', 'UTC')).toBe('sam. 05/06');
  });
});

// The by-timeslot header read the slot on the computer's clock: from Montreal, a 09:00 slot
// in Paris said "Sat 05/06 · 03:00", and a 01:00 slot fell on the day before.
describe('slotHeading', () => {
  it("names a slot by the Event's day and hour, whatever the computer's clock", () => {
    process.env.TZ = 'America/New_York';
    expect(slotHeading('2027-06-05T07:00:00.000Z', 'en', 'Europe/Paris')).toBe('Sat 05/06 · 09:00');
    expect(slotHeading('2027-06-04T23:00:00.000Z', 'fr', 'Europe/Paris')).toBe(
      'sam. 05/06 · 01:00',
    );
  });

  // A text pin: the referee page mounts in no test with its board.
  it("is what the board's header shows, on the Event's zone", () => {
    const page = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');
    expect(page).toContain('slotHeading(row.block.startTime, locale, eventTz)');
  });
});
