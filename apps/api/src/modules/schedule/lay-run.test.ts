import { describe, expect, it } from 'vitest';
import { layRun, shiftRun } from './lay-run';

const DAY = '2026-06-06';
const ms = (hhmmss: string) => Date.parse(`${DAY}T${hhmmss}.000Z`);
const iso = (hhmmss: string) => `${DAY}T${hhmmss}.000Z`;

function bout(id: string, liceId: string, start: string, lengthMinutes = 7) {
  return { id, liceId, startMs: ms(start), lengthMinutes };
}

/** `id → scheduledAt`, for a run whose order across Lices is not the point. */
const startsById = (laid: ReturnType<typeof layRun>) =>
  Object.fromEntries(laid.map((b) => [b.id, b.scheduledAt]));

describe('layRun', () => {
  it('spaces each bout at its length plus the gap, in real milliseconds', () => {
    const laid = layRun({
      bouts: [
        bout('a', 'L1', '10:00:00'),
        bout('b', 'L1', '10:05:00'),
        bout('c', 'L1', '10:10:00'),
      ],
      startMs: ms('10:43:00'),
      gapMs: 10_000,
    });

    expect(laid).toEqual([
      { id: 'a', liceId: 'L1', scheduledAt: iso('10:43:00') },
      { id: 'b', liceId: 'L1', scheduledAt: iso('10:50:10') },
      { id: 'c', liceId: 'L1', scheduledAt: iso('10:57:20') },
    ]);
  });

  it("adds up each bout's own length, not one stride for the run", () => {
    // A bracket round's bouts need not share a length: an 8-minute bout, a
    // 10-minute one, then 8 and 10 again.
    const laid = layRun({
      bouts: [
        bout('r1', 'L1', '10:00:00', 8),
        bout('r2', 'L1', '10:08:00', 10),
        bout('r3', 'L1', '10:18:00', 8),
        bout('r4', 'L1', '10:26:00', 10),
      ],
      startMs: ms('11:00:00'),
      gapMs: 0,
    });

    expect(laid.map((b) => b.scheduledAt)).toEqual([
      iso('11:00:00'),
      iso('11:08:00'),
      iso('11:18:00'),
      iso('11:26:00'),
    ]);
  });

  it('lays two Lices as two queues, both from the run start', () => {
    const laid = layRun({
      bouts: [
        bout('a', 'L1', '10:00:00'),
        bout('b', 'L2', '10:00:00'),
        bout('c', 'L1', '10:10:00'),
        bout('d', 'L2', '10:10:00'),
      ],
      startMs: ms('11:00:00'),
      gapMs: 0,
    });

    expect(startsById(laid)).toEqual({
      a: iso('11:00:00'),
      b: iso('11:00:00'),
      c: iso('11:07:00'),
      d: iso('11:07:00'),
    });
    expect(laid.find((b) => b.id === 'd')?.liceId).toBe('L2');
  });

  it('keeps each Lice in the order its bouts run now, not the order they arrive', () => {
    const laid = layRun({
      bouts: [
        bout('x', 'L1', '10:20:00'),
        bout('y', 'L1', '10:00:00'),
        bout('z', 'L1', '10:10:00'),
      ],
      startMs: ms('11:00:00'),
      gapMs: 0,
    });

    expect(startsById(laid)).toEqual({
      y: iso('11:00:00'),
      z: iso('11:07:00'),
      x: iso('11:14:00'),
    });
  });

  it('breaks a fifteen-bout piste once, after the seventh', () => {
    const laid = layRun({
      bouts: [
        bout('b01', 'L1', '10:00:00', 5),
        bout('b02', 'L1', '10:01:00', 5),
        bout('b03', 'L1', '10:02:00', 5),
        bout('b04', 'L1', '10:03:00', 5),
        bout('b05', 'L1', '10:04:00', 5),
        bout('b06', 'L1', '10:05:00', 5),
        bout('b07', 'L1', '10:06:00', 5),
        bout('b08', 'L1', '10:07:00', 5),
        bout('b09', 'L1', '10:08:00', 5),
        bout('b10', 'L1', '10:09:00', 5),
        bout('b11', 'L1', '10:10:00', 5),
        bout('b12', 'L1', '10:11:00', 5),
        bout('b13', 'L1', '10:12:00', 5),
        bout('b14', 'L1', '10:13:00', 5),
        bout('b15', 'L1', '10:14:00', 5),
      ],
      startMs: ms('10:00:00'),
      gapMs: 0,
      midRestMs: 10 * 60_000,
    });

    expect(laid.map((b) => b.scheduledAt)).toEqual([
      iso('10:00:00'),
      iso('10:05:00'),
      iso('10:10:00'),
      iso('10:15:00'),
      iso('10:20:00'),
      iso('10:25:00'),
      iso('10:30:00'),
      // The break: ten minutes after the seventh bout, once and once only.
      iso('10:45:00'),
      iso('10:50:00'),
      iso('10:55:00'),
      iso('11:00:00'),
      iso('11:05:00'),
      iso('11:10:00'),
      iso('11:15:00'),
      iso('11:20:00'),
    ]);
  });

  it('breaks a six-bout piste after the third', () => {
    const laid = layRun({
      bouts: [
        bout('a', 'L1', '10:00:00', 5),
        bout('b', 'L1', '10:05:00', 5),
        bout('c', 'L1', '10:10:00', 5),
        bout('d', 'L1', '10:15:00', 5),
        bout('e', 'L1', '10:20:00', 5),
        bout('f', 'L1', '10:25:00', 5),
      ],
      startMs: ms('10:00:00'),
      gapMs: 0,
      midRestMs: 10 * 60_000,
    });

    expect(laid.map((b) => b.scheduledAt)).toEqual([
      iso('10:00:00'),
      iso('10:05:00'),
      iso('10:10:00'),
      iso('10:25:00'),
      iso('10:30:00'),
      iso('10:35:00'),
    ]);
  });

  it('breaks a three-bout piste after the first', () => {
    // Half of three, rounded down. The two bouts after the break still run back
    // to back — where a round-robin puts a repeated fighter (ADR-018).
    const laid = layRun({
      bouts: [
        bout('a', 'L1', '10:00:00', 5),
        bout('b', 'L1', '10:05:00', 5),
        bout('c', 'L1', '10:10:00', 5),
      ],
      startMs: ms('10:00:00'),
      gapMs: 0,
      midRestMs: 10 * 60_000,
    });

    expect(laid.map((b) => b.scheduledAt)).toEqual([
      iso('10:00:00'),
      iso('10:15:00'),
      iso('10:20:00'),
    ]);
  });

  it('lays nothing for an empty run', () => {
    expect(layRun({ bouts: [], startMs: ms('10:00:00'), gapMs: 0, midRestMs: 600_000 })).toEqual(
      [],
    );
  });

  it('gives a one-bout piste no break', () => {
    const laid = layRun({
      bouts: [bout('a', 'L1', '10:00:00', 5)],
      startMs: ms('10:00:00'),
      gapMs: 0,
      midRestMs: 10 * 60_000,
    });

    expect(laid).toEqual([{ id: 'a', liceId: 'L1', scheduledAt: iso('10:00:00') }]);
  });

  it("breaks each piste on its own half, not on the run's", () => {
    // Four bouts on one piste, two on the other: the halves are different, and
    // a break counted over the whole run would put both in the same place.
    const laid = layRun({
      bouts: [
        bout('a1', 'L1', '10:00:00', 5),
        bout('b1', 'L2', '10:00:00', 5),
        bout('a2', 'L1', '10:05:00', 5),
        bout('b2', 'L2', '10:05:00', 5),
        bout('a3', 'L1', '10:10:00', 5),
        bout('a4', 'L1', '10:15:00', 5),
      ],
      startMs: ms('10:00:00'),
      gapMs: 0,
      midRestMs: 10 * 60_000,
    });

    expect(startsById(laid)).toEqual({
      a1: iso('10:00:00'),
      a2: iso('10:05:00'),
      a3: iso('10:20:00'),
      a4: iso('10:25:00'),
      b1: iso('10:00:00'),
      b2: iso('10:15:00'),
    });
  });

  it('adds nothing for a rest of zero, and nothing when no rest is asked for', () => {
    const bouts = [
      bout('a', 'L1', '10:00:00', 5),
      bout('b', 'L1', '10:05:00', 5),
      bout('c', 'L1', '10:10:00', 5),
      bout('d', 'L1', '10:15:00', 5),
    ];
    const backToBack = [iso('10:00:00'), iso('10:05:00'), iso('10:10:00'), iso('10:15:00')];

    expect(
      layRun({ bouts, startMs: ms('10:00:00'), gapMs: 0, midRestMs: 0 }).map((b) => b.scheduledAt),
    ).toEqual(backToBack);
    expect(layRun({ bouts, startMs: ms('10:00:00'), gapMs: 0 }).map((b) => b.scheduledAt)).toEqual(
      backToBack,
    );
  });

  it('orders two bouts that start at the same instant by id', () => {
    const laid = layRun({
      bouts: [bout('m-b', 'L1', '10:00:00'), bout('m-a', 'L1', '10:00:00')],
      startMs: ms('11:00:00'),
      gapMs: 0,
    });

    expect(startsById(laid)).toEqual({ 'm-a': iso('11:00:00'), 'm-b': iso('11:07:00') });
  });
});

describe('shiftRun', () => {
  it('keeps a 7-minute-10-second stride to the millisecond: nothing snaps to a slot', () => {
    const shifted = shiftRun({
      bouts: [
        bout('a', 'L1', '10:43:00'),
        bout('b', 'L1', '10:50:10'),
        bout('c', 'L1', '10:57:20'),
      ],
      startMs: ms('11:00:00'),
    });

    expect(shifted).toEqual([
      { id: 'a', liceId: 'L1', scheduledAt: iso('11:00:00') },
      { id: 'b', liceId: 'L1', scheduledAt: iso('11:07:10') },
      { id: 'c', liceId: 'L1', scheduledAt: iso('11:14:20') },
    ]);
  });

  it('anchors the run on its earliest start, wherever that bout sits in the list', () => {
    const shifted = shiftRun({
      bouts: [
        bout('b', 'L1', '10:10:00'),
        bout('a', 'L2', '10:00:00'),
        bout('c', 'L1', '10:20:00'),
      ],
      startMs: ms('09:00:00'),
    });

    expect(startsById(shifted)).toEqual({
      b: iso('09:10:00'),
      a: iso('09:00:00'),
      c: iso('09:20:00'),
    });
  });

  it('moves nothing when the run is already there', () => {
    expect(
      shiftRun({
        bouts: [bout('a', 'L1', '10:00:00'), bout('b', 'L1', '10:07:00')],
        startMs: ms('10:00:00'),
      }),
    ).toEqual([]);
  });

  it('moves nothing for an empty run', () => {
    expect(shiftRun({ bouts: [], startMs: ms('10:00:00') })).toEqual([]);
  });
});
