import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import { buildBoutFlow, type BoutFlowClockEvent } from './bout-flow';

/** Minute `m`, second `s` into a fixed match. */
const at = (m: number, s: number) =>
  `2027-06-21T10:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;

const clock = (type: string, time: string, adjustmentMs?: number): BoutFlowClockEvent => ({
  type,
  occurredAt: time,
  ...(adjustmentMs === undefined ? {} : { adjustmentMs }),
});

/** Pause markers only — the exchange list is irrelevant to the clock fold. */
function pauses(clockEvents?: BoutFlowClockEvent[]) {
  return buildBoutFlow({
    exchanges: [],
    penalties: [],
    redRegId: 'reg-red',
    blueRegId: 'reg-blue',
    matchFormat: DEFAULT_MATCH_FORMAT_CONFIG,
    clockEvents,
  }).pauses;
}

describe('buildBoutFlow — pause markers', () => {
  it('positions a stoppage in match time and measures it in real time', () => {
    // 10s of match time had elapsed; the clock then sat halted for 30s. The
    // marker has no width — halted time never advances the match clock.
    expect(
      pauses([
        clock('start', at(0, 0)),
        clock('halt', at(0, 10)),
        clock('resume', at(0, 40)),
        clock('end', at(1, 10)),
      ]),
    ).toEqual([{ elapsedMs: 10_000, stoppageMs: 30_000 }]);
  });

  it('honours adjust_time so markers stay aligned with exchange clock stamps', () => {
    // 10s − 5s adjustment + 30s of further running = 35s.
    expect(
      pauses([
        clock('start', at(0, 0)),
        clock('halt', at(0, 10)),
        clock('resume', at(0, 40)),
        clock('adjust_time', at(0, 50), -5_000),
        clock('halt', at(1, 10)),
      ]).map((p) => p.elapsedMs),
    ).toEqual([10_000, 35_000]);
  });

  it('drops every marker when the clock is reset', () => {
    expect(
      pauses([clock('start', at(0, 0)), clock('halt', at(0, 10)), clock('reset_clock', at(0, 20))]),
    ).toEqual([]);
  });

  it('keeps accumulating after a reopen without reopening the stoppage', () => {
    expect(
      pauses([
        clock('start', at(0, 0)),
        clock('end', at(0, 30)),
        clock('reopen', at(0, 40)),
        clock('resume', at(0, 45)),
        clock('halt', at(1, 15)),
      ]).map((p) => p.elapsedMs),
    ).toEqual([60_000]);
  });

  it('leaves an unfinished stoppage open at zero duration', () => {
    expect(pauses([clock('start', at(0, 0)), clock('halt', at(0, 10))])).toEqual([
      { elapsedMs: 10_000, stoppageMs: 0 },
    ]);
  });

  it('draws no markers when the surface has no clock access', () => {
    expect(pauses(undefined)).toEqual([]);
  });
});
