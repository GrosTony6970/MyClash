import { describe, expect, it } from 'vitest';
import {
  detectConflicts,
  dutyTimed,
  fightTimed,
  fightWindow,
  toTimed,
  type TimedItem,
} from './conflicts';

const at = (hhmm: string): string => `2027-05-22T${hhmm}:00Z`;

/** A bout as a timed commitment, labelled by its key. */
function bout(key: string, hhmm: string, durationMinutes: number | null): TimedItem {
  const timed = fightTimed(key, key, { scheduledAt: at(hhmm), durationMinutes });
  if (!timed) throw new Error(`bout ${key} has no window`);
  return timed;
}

function workshop(key: string, from: string, to: string): TimedItem {
  const timed = toTimed(key, key, at(from), at(to));
  if (!timed) throw new Error(`workshop ${key} has no window`);
  return timed;
}

describe('fightWindow', () => {
  it('ends a bout at its planned length', () => {
    expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes: 8 })).toEqual({
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('10:08')),
    });
  });

  it('gives a bout whose length the API could not work out no window', () => {
    expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes: null })).toBeNull();
  });

  it('gives no window, and does not throw, for a schedule cached before the API sent a length', () => {
    // The /me pages paint first from localStorage, and nothing validates that copy.
    const cached = JSON.parse(JSON.stringify({ scheduledAt: at('10:00') })) as {
      scheduledAt: string;
      durationMinutes: number | null;
    };
    expect(() => fightWindow(cached)).not.toThrow();
    expect(fightWindow(cached)).toBeNull();
  });

  it('gives no window, and does not throw, for a length that is not a positive number', () => {
    // The API cannot send one (0196's CHECK, the sheet's schema), but the cached copy
    // is not validated, and `matchWindowMs` would throw during render.
    for (const durationMinutes of [0, -5, JSON.parse('1e999') as number]) {
      expect(fightWindow({ scheduledAt: at('10:00'), durationMinutes })).toBeNull();
    }
  });

  it('gives an unplaced bout, or one whose time cannot be read, no window', () => {
    expect(fightWindow({ scheduledAt: null, durationMinutes: 5 })).toBeNull();
    expect(fightWindow({ scheduledAt: 'not a time', durationMinutes: 5 })).toBeNull();
  });
});

describe('toTimed', () => {
  it('needs an end: a start alone has no window', () => {
    expect(toTimed('ws', 'Workshop', at('10:00'), null)).toBeNull();
    expect(toTimed('ws', 'Workshop', at('10:00'), 'not a time')).toBeNull();
    expect(toTimed('ws', 'Workshop', at('10:00'), at('11:00'))).toEqual({
      key: 'ws',
      label: 'Workshop',
      startMs: Date.parse(at('10:00')),
      endMs: Date.parse(at('11:00')),
    });
  });
});

describe('dutyTimed', () => {
  it('times a Pool duty, which has no Match time of its own, by the window the API works out', () => {
    expect(
      dutyTimed('ref-d1', 'Referee', {
        startsAt: '2027-05-22T09:00:00.000Z',
        endsAt: '2027-05-22T09:52:00.000Z',
      }),
    ).toEqual({
      key: 'ref-d1',
      label: 'Referee',
      startMs: Date.parse('2027-05-22T09:00:00.000Z'),
      endMs: Date.parse('2027-05-22T09:52:00.000Z'),
    });
  });

  it('leaves out a duty whose end the API does not know', () => {
    expect(
      dutyTimed('ref-d1', 'Referee', { startsAt: '2027-05-22T09:00:00.000Z', endsAt: null }),
    ).toBeNull();
  });
});

describe('detectConflicts', () => {
  it('flags an 8-minute bout against a Workshop that starts 6 minutes after it', () => {
    // Five guessed minutes would end the bout at 10:05, before the Workshop.
    const conflicts = detectConflicts([bout('bout', '10:00', 8), workshop('ws', '10:06', '11:00')]);
    expect(conflicts.get('bout')).toEqual(['ws']);
    expect(conflicts.get('ws')).toEqual(['bout']);
  });

  it('does not flag windows that only touch', () => {
    expect(detectConflicts([bout('bout', '10:00', 5), workshop('ws', '10:05', '11:00')]).size).toBe(
      0,
    );
  });

  it('names every clash of an item and leaves out the items clear of it', () => {
    const conflicts = detectConflicts([
      bout('a', '10:30', 5),
      bout('b', '11:55', 5),
      bout('c', '12:00', 5),
      workshop('ws', '10:00', '12:00'),
    ]);
    expect(conflicts.get('ws')).toEqual(['a', 'b']);
    expect(conflicts.get('a')).toEqual(['ws']);
    expect(conflicts.has('c')).toBe(false);
  });
});
