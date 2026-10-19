import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from './db';
import { pressBody } from './press-send';

/**
 * The exact body of a queued clock press (`postPress`), key for key: the API's strict schema
 * refuses any other (`ClockActionDto`, whose own test parses this same body), and the pad holds a
 * press at its first 400 with every row of its bout behind it.
 */
const NOW = { wall: Date.parse('2026-10-10T10:20:00.000Z'), page: 0, origin: 2 };
const press = (over: Partial<OutboxEntry>): OutboxEntry => ({
  kind: 'press',
  clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
  matchId: 'm1',
  sequence: 0,
  occurredAt: '2026-10-10T10:00:00.000Z',
  pressAction: 'start',
  createdAt: 0,
  attempts: 0,
  ...over,
});
const TIMES = { pressedAt: '2026-10-10T10:00:00.000Z', sentAt: '2026-10-10T10:20:00.000Z' };
const startedUnder = { rulesId: 'c0000000-0000-4000-8000-00000000000a' };

describe('the body of a clock press', () => {
  it('a Start pressed with no network: the copy it showed and the evidence', () => {
    expect(pressBody(press({ startedUnder, startNetwork: 'none' }), NOW)).toEqual({
      action: 'start',
      clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
      ...TIMES,
      startedUnder,
      pressedWithoutNetwork: true,
    });
  });

  it('a Start that met a network, or not judged yet: the copy only', () => {
    for (const startNetwork of ['seen', undefined] as const) {
      expect(pressBody(press({ startedUnder, startNetwork }), NOW)).toEqual({
        action: 'start',
        clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
        ...TIMES,
        startedUnder,
      });
    }
  });

  // A server of before refuses either key: a tablet reading such a server holds rules with no id.
  it('a Start that names no copy sends neither key, even pressed with no network', () => {
    expect(pressBody(press({ startNetwork: 'none' }), NOW)).toEqual({
      action: 'start',
      clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89',
      ...TIMES,
    });
  });

  it('a Halt sends neither key', () => {
    expect(
      pressBody(press({ pressAction: 'halt', startedUnder, startNetwork: 'none' }), NOW),
    ).toEqual({ action: 'halt', clientUuid: '7dde6260-3b74-4cee-9881-a71e5922bb89', ...TIMES });
  });
});
