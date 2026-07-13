import { describe, expect, it } from 'vitest';
import { timeSimulationOffsetMs } from './time-simulation';

const anchor = '2026-07-13T12:00:00.000Z';

describe('timeSimulationOffsetMs', () => {
  it('returns 0 when disabled', () => {
    expect(
      timeSimulationOffsetMs({
        enabled: false,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: anchor,
      }),
    ).toBe(0);
  });

  it('returns target − anchor when enabled (advances from the set point)', () => {
    // simulated now is one hour after the anchor real time
    const sim = {
      enabled: true,
      simulatedNowIso: '2026-07-13T13:00:00.000Z',
      anchorRealIso: anchor,
    };
    expect(timeSimulationOffsetMs(sim)).toBe(60 * 60 * 1000);
  });

  it('supports a large forward jump into the future', () => {
    const target = Date.parse('2027-05-22T08:00:00.000Z');
    const sim = {
      enabled: true,
      simulatedNowIso: '2027-05-22T08:00:00.000Z',
      anchorRealIso: anchor,
    };
    expect(timeSimulationOffsetMs(sim)).toBe(target - Date.parse(anchor));
  });

  it('returns 0 when a timestamp is missing', () => {
    expect(
      timeSimulationOffsetMs({ enabled: true, simulatedNowIso: null, anchorRealIso: anchor }),
    ).toBe(0);
    expect(
      timeSimulationOffsetMs({
        enabled: true,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: null,
      }),
    ).toBe(0);
  });

  it('returns 0 when a timestamp is unparseable', () => {
    expect(
      timeSimulationOffsetMs({
        enabled: true,
        simulatedNowIso: 'not-a-date',
        anchorRealIso: anchor,
      }),
    ).toBe(0);
  });
});
