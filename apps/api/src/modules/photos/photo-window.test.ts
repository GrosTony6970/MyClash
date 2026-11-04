import { describe, expect, it } from 'vitest';
import { photoUploadWindow } from './photo-window';

/** 00:00 of `day` on `zone`'s clock, as an instant: what an organiser in that zone calls midnight. */
function midnight(day: string, zone: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const seen = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    guess -= seen - Date.UTC(y, m - 1, d);
  }
  return guess;
}

describe('photoUploadWindow — an Event on 16 and 17 May 2026', () => {
  it.each(['UTC', 'Europe/Paris', 'America/New_York', 'Pacific/Kiritimati'])(
    'on %s, opens at the start of set-up day and closes at the end of the day after',
    (zone) => {
      const window = photoUploadWindow({
        start_date: '2026-05-16',
        end_date: '2026-05-17',
        timezone: zone,
      })!;
      const open = (instant: number) =>
        instant >= window.opensAt.getTime() && instant < window.closesAt.getTime();

      expect(open(midnight('2026-05-15', zone) - 1)).toBe(false);
      expect(open(midnight('2026-05-15', zone))).toBe(true);
      expect(open(midnight('2026-05-19', zone) - 1)).toBe(true);
      expect(open(midnight('2026-05-19', zone))).toBe(false);
    },
  );

  it('reads an unknown zone on the default Event clock rather than failing', () => {
    expect(
      photoUploadWindow({
        start_date: '2026-05-16',
        end_date: '2026-05-17',
        timezone: 'Mars/Olympus',
      }),
    ).not.toBeNull();
  });
});
