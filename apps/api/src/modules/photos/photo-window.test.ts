import { describe, expect, it } from 'vitest';
import {
  photoArchiveHold,
  photoDeletionInstant,
  photoSendOpen,
  photosExpired,
  photoUploadWindow,
} from './photo-window';

describe('photosExpired — the queue and the download read one rule', () => {
  const event = { end_date: '2026-05-18', timezone: 'UTC' };
  const instant = Date.parse('2026-06-18T00:00:00.000Z');

  it('is false until the deletion instant and true from it on', () => {
    expect(photosExpired(event, new Date(instant - 1))).toBe(false);
    expect(photosExpired(event, new Date(instant))).toBe(true);
  });

  it('is false when the end date cannot be read: nothing says the photos are gone', () => {
    expect(photosExpired({ end_date: null, timezone: 'UTC' }, new Date(instant))).toBe(false);
  });
});

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

describe('photoDeletionInstant — an Event ending 17 May 2026', () => {
  it.each(['UTC', 'Europe/Paris', 'America/New_York', 'Pacific/Kiritimati'])(
    'on %s, is 00:00 of 17 June, the 31st day after the last, on the Event clock',
    (zone) => {
      const instant = photoDeletionInstant({ end_date: '2026-05-17', timezone: zone });
      expect(instant?.getTime()).toBe(midnight('2026-06-17', zone));
    },
  );

  it('follows the current end date: moving the last day moves the instant', () => {
    expect(photoDeletionInstant({ end_date: '2026-05-18', timezone: 'UTC' })?.toISOString()).toBe(
      '2026-06-18T00:00:00.000Z',
    );
  });

  it('is null when the end date cannot be read', () => {
    expect(photoDeletionInstant({ end_date: 'next Tuesday', timezone: 'UTC' })).toBeNull();
    expect(photoDeletionInstant({ end_date: null, timezone: 'UTC' })).toBeNull();
  });

  it('reads an unknown zone on the default Event clock', () => {
    expect(
      photoDeletionInstant({ end_date: '2026-05-17', timezone: 'Mars/Olympus' })?.getTime(),
    ).toBe(midnight('2026-06-17', 'Europe/Paris'));
  });
});

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

describe('photoArchiveHold — an Event on 16 and 17 May 2026 (ruling 441)', () => {
  const cup = (photo_mode: string, timezone: unknown = 'Europe/Paris') => ({
    start_date: '2026-05-16',
    end_date: '2026-05-17',
    timezone,
    photo_mode,
  });
  const at = (instant: number) => new Date(instant);

  it.each(['UTC', 'Europe/Paris', 'America/New_York', 'Pacific/Kiritimati'])(
    'on %s, holds the archive until the window closes, and not at the close itself',
    (zone) => {
      const close = midnight('2026-05-19', zone);
      expect(photoArchiveHold(cup('approve', zone), at(close - 1))?.getTime()).toBe(close);
      expect(photoArchiveHold(cup('approve', zone), at(close))).toBeNull();
    },
  );

  it('holds in Live mode too', () => {
    const close = midnight('2026-05-19', 'Europe/Paris');
    expect(photoArchiveHold(cup('live'), at(close - 1))?.getTime()).toBe(close);
  });

  it('never holds when photos are Off', () => {
    expect(photoArchiveHold(cup('off'), at(midnight('2026-05-18', 'Europe/Paris')))).toBeNull();
  });

  it('ends at midnight on the Event clock across a clock change (Paris, back on 25 Oct)', () => {
    const event = {
      start_date: '2026-10-24',
      end_date: '2026-10-24',
      timezone: 'Europe/Paris',
      photo_mode: 'approve',
    };
    expect(photoArchiveHold(event, new Date('2026-10-25T22:59:59.999Z'))?.toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
    expect(photoArchiveHold(event, new Date('2026-10-25T23:00:00.000Z'))).toBeNull();
  });

  it('reads an unknown zone on the default Event clock, as the upload door does', () => {
    const close = midnight('2026-05-19', 'Europe/Paris');
    expect(photoArchiveHold(cup('approve', 'Mars/Olympus'), at(close - 1))?.getTime()).toBe(close);
  });

  it('never holds when the window cannot be read: the door then refuses every photo', () => {
    const event = { ...cup('approve'), start_date: null };
    expect(photoArchiveHold(event, at(midnight('2026-05-18', 'Europe/Paris')))).toBeNull();
  });
});

describe('photoSendOpen — an Event on 16 and 17 May 2026, Paris (ruling 463)', () => {
  const cup = (photo_mode: unknown, end_date: string | null = '2026-05-17') => ({
    start_date: '2026-05-16',
    end_date,
    timezone: 'Europe/Paris',
    photo_mode,
  });
  const opens = midnight('2026-05-15', 'Europe/Paris');
  const closes = midnight('2026-05-19', 'Europe/Paris');
  const at = (instant: number) => new Date(instant);

  it.each(['live', 'approve'])('is open in %s mode from the open instant on', (mode) => {
    expect(photoSendOpen(cup(mode), at(opens))).toBe(true);
    expect(photoSendOpen(cup(mode), at(closes - 1))).toBe(true);
  });

  it('is shut before the window opens and at its close itself (half-open, as the door)', () => {
    expect(photoSendOpen(cup('live'), at(opens - 1))).toBe(false);
    expect(photoSendOpen(cup('live'), at(closes))).toBe(false);
  });

  it('is shut when photos are Off, inside the window', () => {
    expect(photoSendOpen(cup('off'), at(opens))).toBe(false);
  });

  it('is shut when the window cannot be read', () => {
    expect(photoSendOpen(cup('live', null), at(opens))).toBe(false);
  });

  it('is open for a mode this build does not know: the door refuses only Off', () => {
    expect(photoSendOpen(cup('later'), at(opens))).toBe(true);
  });
});
