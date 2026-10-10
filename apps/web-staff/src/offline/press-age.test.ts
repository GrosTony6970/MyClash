import { describe, expect, it } from 'vitest';
import { pressAgeMs, pressTimes, type PressMoment, type TabletTime } from './press-age';

const PAGE = 1_760_000_000_000;
const TEN = Date.parse('2026-10-10T10:00:00.000Z');
const MINUTE = 60_000;

/** A press made at 10:00 by the tablet's time of day, 5 minutes after the page opened. */
const PRESS: PressMoment = {
  occurredAt: new Date(TEN).toISOString(),
  pressedPerf: 5 * MINUTE,
  pressOrigin: PAGE,
};

/** The tablet's clocks `wallMinutes` and `pageMinutes` after the press. */
const later = (wallMinutes: number, pageMinutes: number, origin = PAGE): TabletTime => ({
  wall: TEN + wallMinutes * MINUTE,
  page: 5 * MINUTE + pageMinutes * MINUTE,
  origin,
});

describe('pressAgeMs', () => {
  it('is the time since the press when the two clocks agree', () => {
    expect(pressAgeMs(PRESS, later(20, 20))).toBe(20 * MINUTE);
  });

  it('a time of day corrected BACK between the press and the send does not make it young', () => {
    // The tablet said 10:00 and was an hour ahead. At reconnect it says 09:20.
    expect(pressAgeMs(PRESS, later(-40, 20))).toBe(20 * MINUTE);
  });

  it('a tablet that slept keeps the time it slept: the page’s clock stopped', () => {
    expect(pressAgeMs(PRESS, later(20, 3))).toBe(20 * MINUTE);
  });

  it('a reloaded page reads the time of day: the page’s clock is another one', () => {
    expect(pressAgeMs(PRESS, { wall: TEN + 20 * MINUTE, page: 9_000, origin: PAGE + 1 })).toBe(
      20 * MINUTE,
    );
  });

  it('does not read the page’s clock of another page, even one that has run longer', () => {
    // The pad was reloaded, and left open for 99 minutes on the new page.
    const reloaded = { wall: TEN + 20 * MINUTE, page: 99 * MINUTE, origin: PAGE + 1 };

    expect(pressAgeMs(PRESS, reloaded)).toBe(20 * MINUTE);
  });

  it('is never under zero, on a reloaded page whose time of day went back', () => {
    expect(pressAgeMs(PRESS, { wall: TEN - 40 * MINUTE, page: 9_000, origin: PAGE + 1 })).toBe(0);
  });

  it('a row with no page clock reads the time of day', () => {
    expect(pressAgeMs({ occurredAt: PRESS.occurredAt }, later(7, 7))).toBe(7 * MINUTE);
  });

  it('a row whose time cannot be read is as old as the page’s clock says', () => {
    expect(pressAgeMs({ ...PRESS, occurredAt: 'not a time' }, later(20, 20))).toBe(20 * MINUTE);
  });
});

describe('pressTimes', () => {
  it('sends the press’s own time, and a send time that is that time plus the age', () => {
    expect(pressTimes(PRESS, later(-40, 20))).toEqual({
      pressedAt: '2026-10-10T10:00:00.000Z',
      sentAt: '2026-10-10T10:20:00.000Z',
    });
  });

  it('a press sent in the same instant has an age of zero', () => {
    const times = pressTimes(PRESS, later(0, 0));

    expect(times.sentAt).toBe(times.pressedAt);
  });

  it('a row whose time cannot be read still sends two readable times', () => {
    const times = pressTimes({ ...PRESS, occurredAt: 'not a time' }, later(20, 20));

    expect(Date.parse(times.sentAt) - Date.parse(times.pressedAt)).toBe(20 * MINUTE);
  });
});
