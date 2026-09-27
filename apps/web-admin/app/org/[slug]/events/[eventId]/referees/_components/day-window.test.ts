import { describe, expect, it } from 'vitest';
import { WHOLE_DAY, daysBody, windowOfText, windowText } from './day-window';

describe('daysBody', () => {
  it('sends a whole day as its date alone, and a window as both minutes', () => {
    expect(
      daysBody([
        { date: '2026-09-12', fromMinute: null, toMinute: null },
        { date: '2026-09-13', fromMinute: 540, toMinute: 1440 },
      ]),
    ).toEqual([{ date: '2026-09-12' }, { date: '2026-09-13', fromMinute: 540, toMinute: 1440 }]);
  });
});

describe('windowOfText', () => {
  it('reads both boxes empty as the whole day', () => {
    expect(windowOfText('', '')).toEqual(WHOLE_DAY);
  });

  it('reads an empty box as the edge of the day', () => {
    expect(windowOfText('', '16:00')).toEqual({ fromMinute: 0, toMinute: 960 });
    expect(windowOfText('09:30', '')).toEqual({ fromMinute: 570, toMinute: 1440 });
  });

  it('reads both boxes', () => {
    expect(windowOfText('09:00', '16:00')).toEqual({ fromMinute: 540, toMinute: 960 });
  });

  it('refuses a window that does not run forward', () => {
    expect(windowOfText('16:00', '16:00')).toBeNull();
    expect(windowOfText('17:00', '09:00')).toBeNull();
  });

  it('stores midnight to midnight as no window', () => {
    expect(windowOfText('00:00', '')).toEqual(WHOLE_DAY);
  });
});

describe('windowText', () => {
  it('shows the whole day as two empty boxes, and a day edge as an empty box', () => {
    expect(windowText(WHOLE_DAY)).toEqual({ from: '', until: '' });
    expect(windowText({ fromMinute: 0, toMinute: 960 })).toEqual({ from: '', until: '16:00' });
    expect(windowText({ fromMinute: 570, toMinute: 1440 })).toEqual({ from: '09:30', until: '' });
  });

  it('round-trips through the boxes', () => {
    const window = { fromMinute: 545, toMinute: 1005 };
    const { from, until } = windowText(window);
    expect(windowOfText(from, until)).toEqual(window);
  });
});
