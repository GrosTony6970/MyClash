import { describe, expect, it } from 'vitest';
import { ANY_AVAILABILITY, isAvailableFor, type RefereeAvailability } from './referee-availability';

const H = (hh: number, mm = 0) => Date.UTC(2026, 8, 12, hh, mm);
const at = (from: [number, number?], to: [number, number?]) => ({
  startMs: H(...from),
  endMs: H(...to),
});

/** Saturday 12 September, midnight to the next midnight (the test's clock is UTC). */
const SATURDAY = { startMs: H(0), endMs: H(24) };

const saturdayUntil16: RefereeAvailability = {
  tournamentIds: null,
  days: [{ date: '2026-09-12', window: at([9], [16]) }],
};

const ask = (over: Partial<Parameters<typeof isAvailableFor>[1]> = {}) => ({
  tournamentId: 't-ls',
  date: '2026-09-12',
  window: at([10], [11]),
  ...over,
});

describe('isAvailableFor', () => {
  it('no tick on either axis = available for anything, timed or not', () => {
    expect(isAvailableFor(ANY_AVAILABILITY, ask())).toBe(true);
    expect(isAvailableFor(ANY_AVAILABILITY, ask({ date: null, window: null }))).toBe(true);
  });

  it('a ticked Tournament list refuses another Tournament, on any day', () => {
    const av: RefereeAvailability = { tournamentIds: ['t-ls'], days: null };
    expect(isAvailableFor(av, ask())).toBe(true);
    expect(isAvailableFor(av, ask({ tournamentId: 't-sabre' }))).toBe(false);
    expect(isAvailableFor(av, ask({ tournamentId: 't-sabre', date: null, window: null }))).toBe(
      false,
    );
  });

  it('a ticked day list refuses another date, and a whole-day tick takes any time', () => {
    const av: RefereeAvailability = {
      tournamentIds: null,
      days: [{ date: '2026-09-12', window: SATURDAY }],
    };
    expect(isAvailableFor(av, ask({ window: at([23], [23, 59]) }))).toBe(true);
    expect(isAvailableFor(av, ask({ date: '2026-09-13' }))).toBe(false);
  });

  it('a date outside the Event never matches: only the dates on the rows count', () => {
    const av: RefereeAvailability = {
      tournamentIds: null,
      days: [{ date: '2026-09-14', window: { startMs: H(48), endMs: H(72) } }],
    };
    expect(isAvailableFor(av, ask())).toBe(false);
  });

  it('something untimed is never refused on its day or time, only on its Tournament', () => {
    expect(isAvailableFor(saturdayUntil16, ask({ date: null, window: null }))).toBe(true);
    expect(isAvailableFor(saturdayUntil16, ask({ window: null }))).toBe(true);
  });

  it('the whole duty must fit: half-open at both edges', () => {
    // Ends exactly when the window ends: fits.
    expect(isAvailableFor(saturdayUntil16, ask({ window: at([15], [16]) }))).toBe(true);
    // Starts exactly when the window starts: fits.
    expect(isAvailableFor(saturdayUntil16, ask({ window: at([9], [10]) }))).toBe(true);
    // Runs past the end by a minute: refused.
    expect(isAvailableFor(saturdayUntil16, ask({ window: at([15, 30], [16, 1]) }))).toBe(false);
    // Starts at the end: refused.
    expect(isAvailableFor(saturdayUntil16, ask({ window: at([16], [17]) }))).toBe(false);
    // Starts a minute before the window: refused.
    expect(isAvailableFor(saturdayUntil16, ask({ window: at([8, 59], [10]) }))).toBe(false);
  });

  it('a whole-day tick refuses a duty crossing midnight, as a window ending at midnight does', () => {
    const av: RefereeAvailability = {
      tournamentIds: null,
      days: [{ date: '2026-09-12', window: SATURDAY }],
    };
    expect(isAvailableFor(av, ask({ window: { startMs: H(23), endMs: H(24, 30) } }))).toBe(false);
    expect(isAvailableFor(av, ask({ window: { startMs: H(23), endMs: H(24) } }))).toBe(true);
  });

  it('a duty crossing midnight is judged on its start date and fails a window that ends first', () => {
    const av: RefereeAvailability = {
      tournamentIds: null,
      days: [{ date: '2026-09-12', window: { startMs: H(20), endMs: H(24) } }],
    };
    expect(isAvailableFor(av, ask({ window: { startMs: H(23), endMs: H(24, 30) } }))).toBe(false);
    expect(isAvailableFor(av, ask({ window: { startMs: H(23), endMs: H(24) } }))).toBe(true);
  });

  it('both axes must allow it', () => {
    const av: RefereeAvailability = {
      tournamentIds: ['t-ls'],
      days: [{ date: '2026-09-12', window: SATURDAY }],
    };
    expect(isAvailableFor(av, ask({ tournamentId: 't-sabre' }))).toBe(false);
    expect(isAvailableFor(av, ask({ date: '2026-09-13' }))).toBe(false);
    expect(isAvailableFor(av, ask())).toBe(true);
  });
});
