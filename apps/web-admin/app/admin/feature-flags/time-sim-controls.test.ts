import { describe, expect, it } from 'vitest';
import { buildTimeSimPayload, isoToLocalInput, readSimulatedNowIso } from './time-sim-controls';

describe('the time-simulation panel payloads', () => {
  it('sends only the simulated instant; the API stamps the anchor', () => {
    const local = '2027-05-22T09:00';
    expect(buildTimeSimPayload(local)).toEqual({
      simulatedNowIso: new Date(local).toISOString(),
    });
  });

  it('sends nothing for an empty or broken date', () => {
    expect(buildTimeSimPayload('')).toBeUndefined();
    expect(buildTimeSimPayload('not-a-date')).toBeUndefined();
  });

  it('round-trips a stored instant through the date input', () => {
    const local = '2027-05-22T09:00';
    const stored = buildTimeSimPayload(local)!;
    expect(isoToLocalInput(readSimulatedNowIso(stored))).toBe(local);
  });
});
