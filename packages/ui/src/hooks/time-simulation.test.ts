import { describe, expect, it } from 'vitest';
import { clockSkewMs, isTimeSimulationActive, timeSimulationOffsetMs } from './time-simulation';

const anchor = '2026-07-13T12:00:00.000Z';

describe('clockSkewMs', () => {
  it('is 0 for a browser in step with the server', () => {
    const sent = Date.parse(anchor) - 100;
    expect(clockSkewMs(anchor, sent, sent + 200)).toBe(0);
  });

  it('is negative for a browser that runs fast, read against the round-trip midpoint', () => {
    // The browser reads 12:03:00 when the server reads 12:00:00.
    const browserMs = Date.parse(anchor) + 3 * 60_000;
    expect(clockSkewMs(anchor, browserMs - 400, browserMs + 400)).toBe(-3 * 60_000);
  });

  it('is 0 when the server time does not parse', () => {
    expect(clockSkewMs('not-a-date', 1_000, 2_000)).toBe(0);
  });
});

describe('timeSimulationOffsetMs', () => {
  it('returns 0 when disabled', () => {
    expect(
      timeSimulationOffsetMs(
        { enabled: false, simulatedNowIso: '2027-05-22T08:00:00.000Z', anchorRealIso: anchor },
        0,
      ),
    ).toBe(0);
  });

  it('returns target − anchor when enabled (advances from the set point)', () => {
    // simulated now is one hour after the anchor real time
    const sim = {
      enabled: true,
      simulatedNowIso: '2026-07-13T13:00:00.000Z',
      anchorRealIso: anchor,
    };
    expect(timeSimulationOffsetMs(sim, 0)).toBe(60 * 60 * 1000);
  });

  it('supports a large forward jump into the future', () => {
    const target = Date.parse('2027-05-22T08:00:00.000Z');
    const sim = {
      enabled: true,
      simulatedNowIso: '2027-05-22T08:00:00.000Z',
      anchorRealIso: anchor,
    };
    expect(timeSimulationOffsetMs(sim, 0)).toBe(target - Date.parse(anchor));
  });

  it('gives a browser 3 min fast the same simulated now as the server', () => {
    const sim = {
      enabled: true,
      simulatedNowIso: '2027-05-22T08:00:00.000Z',
      anchorRealIso: anchor,
    };
    const serverMs = Date.parse(anchor) + 10 * 60_000;
    const fastBrowserMs = serverMs + 3 * 60_000;
    const skew = clockSkewMs(new Date(serverMs).toISOString(), fastBrowserMs, fastBrowserMs);
    expect(fastBrowserMs + timeSimulationOffsetMs(sim, skew)).toBe(
      serverMs + timeSimulationOffsetMs(sim, 0),
    );
    expect(fastBrowserMs + timeSimulationOffsetMs(sim, skew)).toBe(
      Date.parse('2027-05-22T08:10:00.000Z'),
    );
  });

  it('ignores the skew when no simulation is active, so real time stays the browser clock', () => {
    expect(
      timeSimulationOffsetMs(
        { enabled: false, simulatedNowIso: null, anchorRealIso: null },
        -180_000,
      ),
    ).toBe(0);
  });

  it('returns 0 when a timestamp is missing', () => {
    expect(
      timeSimulationOffsetMs({ enabled: true, simulatedNowIso: null, anchorRealIso: anchor }, 0),
    ).toBe(0);
    expect(
      timeSimulationOffsetMs(
        { enabled: true, simulatedNowIso: '2027-05-22T08:00:00.000Z', anchorRealIso: null },
        0,
      ),
    ).toBe(0);
  });

  it('returns 0 when a timestamp is unparseable', () => {
    expect(
      timeSimulationOffsetMs(
        { enabled: true, simulatedNowIso: 'not-a-date', anchorRealIso: anchor },
        0,
      ),
    ).toBe(0);
  });
});

describe('isTimeSimulationActive', () => {
  it('is true when enabled with two parseable timestamps', () => {
    expect(
      isTimeSimulationActive({
        enabled: true,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: anchor,
      }),
    ).toBe(true);
  });

  it('stays true for a zero offset — simulating to "about now" is still simulating', () => {
    // The whole point of this helper: callers use it to decide whether live match
    // data can be trusted, which a near-zero offset must not silently disable.
    const sim = { enabled: true, simulatedNowIso: anchor, anchorRealIso: anchor };
    expect(timeSimulationOffsetMs(sim, 0)).toBe(0);
    expect(isTimeSimulationActive(sim)).toBe(true);
  });

  it('is false when disabled', () => {
    expect(
      isTimeSimulationActive({
        enabled: false,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: anchor,
      }),
    ).toBe(false);
  });

  it('is false when a timestamp is missing', () => {
    expect(
      isTimeSimulationActive({ enabled: true, simulatedNowIso: null, anchorRealIso: anchor }),
    ).toBe(false);
    expect(
      isTimeSimulationActive({
        enabled: true,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: null,
      }),
    ).toBe(false);
  });

  it('is false when a timestamp is unparseable', () => {
    expect(
      isTimeSimulationActive({
        enabled: true,
        simulatedNowIso: 'not-a-date',
        anchorRealIso: anchor,
      }),
    ).toBe(false);
  });
});
