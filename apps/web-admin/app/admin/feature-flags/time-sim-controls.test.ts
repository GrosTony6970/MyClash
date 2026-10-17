import { describe, expect, it } from 'vitest';
import {
  buildTimeSimPayload,
  isoToLocalInput,
  payloadAt,
  readSimulatedNowIso,
  readTimeSimMode,
} from './time-sim-controls';

describe('the time-simulation panel payloads', () => {
  it('sends the simulated instant and the mode; the API stamps the anchor', () => {
    const local = '2027-05-22T09:00';
    expect(buildTimeSimPayload(local, 'frozen')).toEqual({
      simulatedNowIso: new Date(local).toISOString(),
      mode: 'frozen',
    });
  });

  it('sends nothing for an empty or broken date', () => {
    expect(buildTimeSimPayload('', 'running')).toBeUndefined();
    expect(buildTimeSimPayload('not-a-date', 'running')).toBeUndefined();
  });

  it('round-trips a stored instant through the date input', () => {
    const local = '2027-05-22T09:00';
    const stored = buildTimeSimPayload(local, 'running')!;
    expect(isoToLocalInput(readSimulatedNowIso(stored))).toBe(local);
  });

  it('sets the clock to an exact instant in a mode', () => {
    expect(payloadAt(Date.parse('2027-05-22T08:15:30.000Z'), 'frozen')).toEqual({
      simulatedNowIso: '2027-05-22T08:15:30.000Z',
      mode: 'frozen',
    });
  });
});

describe('readTimeSimMode', () => {
  it('reads the stored mode', () => {
    expect(readTimeSimMode({ mode: 'frozen' })).toBe('frozen');
    expect(readTimeSimMode({ mode: 'running' })).toBe('running');
  });

  it('starts a never-saved flag as a running clock', () => {
    expect(readTimeSimMode(null)).toBe('running');
    expect(readTimeSimMode({})).toBe('running');
  });
});
