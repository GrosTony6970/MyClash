import { describe, expect, it } from 'vitest';
import { isLiveStatus } from './match-status';

describe('isLiveStatus', () => {
  it('counts a running bout as live', () => {
    expect(isLiveStatus('running')).toBe(true);
  });

  it('counts a PAUSED bout as live — the piste is still occupied', () => {
    // The whole reason this predicate is shared: three surfaces read
    // `status === 'running'` and blanked the piste the moment a referee
    // called a halt.
    expect(isLiveStatus('paused')).toBe(true);
  });

  it('does not count a bout that has not started', () => {
    expect(isLiveStatus('scheduled')).toBe(false);
  });

  it('does not count a finished or voided bout', () => {
    expect(isLiveStatus('completed')).toBe(false);
    expect(isLiveStatus('voided')).toBe(false);
  });

  it('tolerates a missing status rather than throwing', () => {
    expect(isLiveStatus(null)).toBe(false);
    expect(isLiveStatus(undefined)).toBe(false);
    expect(isLiveStatus('')).toBe(false);
  });
});
