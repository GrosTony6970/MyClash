import { describe, expect, it, vi } from 'vitest';
import {
  serverSkewMs,
  isTimeSimulationActive,
  isTimeSimulationFrozen,
  simulatedNowMs,
} from './time-simulation';

const anchor = '2026-07-13T12:00:00.000Z';
const anchorMs = Date.parse(anchor);
const target = '2027-05-22T08:00:00.000Z';
const targetMs = Date.parse(target);
const MIN = 60_000;

const running = {
  enabled: true,
  simulatedNowIso: target,
  anchorRealIso: anchor,
  mode: 'running' as const,
};
const frozen = { ...running, mode: 'frozen' as const };

describe('serverSkewMs', () => {
  it('is 0 for a browser in step with the server', () => {
    const sent = anchorMs - 100;
    expect(serverSkewMs(anchor, sent, sent + 200)).toBe(0);
  });

  it('is negative for a browser that runs fast, read against the round-trip midpoint', () => {
    // The browser reads 12:03:00 when the server reads 12:00:00.
    const browserMs = anchorMs + 3 * MIN;
    expect(serverSkewMs(anchor, browserMs - 400, browserMs + 400)).toBe(-3 * MIN);
  });

  it('is 0 when the server time does not parse, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(serverSkewMs('not-a-date', 1_000, 2_000)).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('runs on its own clock'));
    warn.mockRestore();
  });
});

describe('simulatedNowMs', () => {
  it('reads the set point at the anchor, then advances one for one with real time', () => {
    expect(simulatedNowMs(running, anchorMs, 0)).toBe(targetMs);
    expect(simulatedNowMs(running, anchorMs + 10 * MIN, 0)).toBe(targetMs + 10 * MIN);
  });

  it('holds a frozen clock on the set point however far real time moves', () => {
    expect(simulatedNowMs(frozen, anchorMs, 0)).toBe(targetMs);
    expect(simulatedNowMs(frozen, anchorMs + 5 * 60 * MIN, 0)).toBe(targetMs);
    expect(simulatedNowMs(frozen, anchorMs, -3 * MIN)).toBe(targetMs);
  });

  it('gives a browser 3 min fast the same simulated now as the server', () => {
    const serverMs = anchorMs + 10 * MIN;
    const fastBrowserMs = serverMs + 3 * MIN;
    const skew = serverSkewMs(new Date(serverMs).toISOString(), fastBrowserMs, fastBrowserMs);
    expect(simulatedNowMs(running, fastBrowserMs, skew)).toBe(simulatedNowMs(running, serverMs, 0));
    expect(simulatedNowMs(running, fastBrowserMs, skew)).toBe(targetMs + 10 * MIN);
  });

  it('leaves real time on the browser clock, skew and all, when nothing is simulated', () => {
    const realMs = anchorMs + 7 * MIN;
    expect(simulatedNowMs({ ...running, enabled: false }, realMs, -3 * MIN)).toBe(realMs);
  });

  it('returns real time when a timestamp or the mode is missing', () => {
    const realMs = anchorMs + 7 * MIN;
    expect(simulatedNowMs({ ...running, simulatedNowIso: null }, realMs, 0)).toBe(realMs);
    expect(simulatedNowMs({ ...running, anchorRealIso: null }, realMs, 0)).toBe(realMs);
    expect(simulatedNowMs({ ...frozen, mode: null }, realMs, 0)).toBe(realMs);
  });

  it('returns real time when a timestamp is unparseable', () => {
    const realMs = anchorMs + 7 * MIN;
    expect(simulatedNowMs({ ...frozen, simulatedNowIso: 'not-a-date' }, realMs, 0)).toBe(realMs);
  });
});

describe('isTimeSimulationActive', () => {
  it('is true when enabled with a mode and two parseable timestamps', () => {
    expect(isTimeSimulationActive(running)).toBe(true);
    expect(isTimeSimulationActive(frozen)).toBe(true);
  });

  it('stays true for a zero offset — simulating to "about now" is still simulating', () => {
    // The whole point of this helper: callers use it to decide whether live match
    // data can be trusted, which a near-zero offset must not silently disable.
    const sim = { ...running, simulatedNowIso: anchor };
    expect(simulatedNowMs(sim, anchorMs, 0)).toBe(anchorMs);
    expect(isTimeSimulationActive(sim)).toBe(true);
  });

  it('is false when disabled', () => {
    expect(isTimeSimulationActive({ ...running, enabled: false })).toBe(false);
  });

  it('is false when a timestamp or the mode is missing', () => {
    expect(isTimeSimulationActive({ ...running, simulatedNowIso: null })).toBe(false);
    expect(isTimeSimulationActive({ ...running, anchorRealIso: null })).toBe(false);
    expect(isTimeSimulationActive({ ...running, mode: null })).toBe(false);
  });

  it('is false when a timestamp is unparseable', () => {
    expect(isTimeSimulationActive({ ...running, simulatedNowIso: 'not-a-date' })).toBe(false);
  });
});

describe('isTimeSimulationFrozen', () => {
  it('is true only for an active frozen simulation', () => {
    expect(isTimeSimulationFrozen(frozen)).toBe(true);
    expect(isTimeSimulationFrozen(running)).toBe(false);
    expect(isTimeSimulationFrozen({ ...frozen, enabled: false })).toBe(false);
  });
});
