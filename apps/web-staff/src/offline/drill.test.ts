import { describe, expect, it } from 'vitest';
import { canStartDrill, drillRemainingMs, isDrillActiveAt } from './drill';

const NOW = 1_700_000_000_000;

describe('isDrillActiveAt', () => {
  it('is active while the window is open', () => {
    expect(isDrillActiveAt(NOW + 60_000, NOW)).toBe(true);
  });

  it('self-expires without anything having to fire a timer', () => {
    // A tablet left asleep through the end of a drill must wake up syncing
    // normally. If expiry needed a timer, a suspended tab would come back
    // still refusing to sync.
    expect(isDrillActiveAt(NOW + 60_000, NOW + 60_001)).toBe(false);
  });

  it('is inactive exactly at the boundary', () => {
    expect(isDrillActiveAt(NOW, NOW)).toBe(false);
  });

  it('is inactive when nothing is stored', () => {
    expect(isDrillActiveAt(0, NOW)).toBe(false);
  });
});

describe('drillRemainingMs', () => {
  it('counts down', () => {
    expect(drillRemainingMs(NOW + 45_000, NOW)).toBe(45_000);
  });

  it('floors at zero rather than going negative', () => {
    expect(drillRemainingMs(NOW, NOW + 10_000)).toBe(0);
  });
});

describe('canStartDrill', () => {
  it('allows a drill on a clean outbox', () => {
    expect(canStartDrill(0, 0)).toBe(true);
  });

  it('refuses while hits are already queued', () => {
    // Starting a drill on top of a genuine sync problem mixes real and
    // simulated failure in one bar, and the operator cannot tell which hits
    // are which.
    expect(canStartDrill(3, 0)).toBe(false);
  });

  it('refuses while hits are held in quarantine', () => {
    expect(canStartDrill(0, 1)).toBe(false);
  });
});
