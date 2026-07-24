// status.test.ts
import { describe, it, expect } from 'vitest';
import { deriveStatus, worstStatus } from './status';

describe('deriveStatus', () => {
  it('healthy below warn', () => expect(deriveStatus(50, 70, 90)).toBe('healthy'));
  it('warning at/above warn, below crit', () => expect(deriveStatus(75, 70, 90)).toBe('warning'));
  it('critical at/above crit', () => expect(deriveStatus(95, 70, 90)).toBe('critical'));
  it('boundary: exactly warn is warning', () => expect(deriveStatus(70, 70, 90)).toBe('warning'));
});

describe('worstStatus', () => {
  it('critical dominates', () =>
    expect(worstStatus('healthy', 'warning', 'critical')).toBe('critical'));
  it('unavailable beats healthy but not warning', () =>
    expect(worstStatus('healthy', 'unavailable')).toBe('unavailable'));
  it('all healthy', () => expect(worstStatus('healthy', 'healthy')).toBe('healthy'));
});
