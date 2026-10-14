import { afterEach, describe, expect, it } from 'vitest';
import { formatDayShort } from './day-label';

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
