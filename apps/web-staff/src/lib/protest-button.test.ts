import { describe, expect, it } from 'vitest';
import { protestButtonLive } from './protest-button';

/**
 * The protest button is live longer than card entry: paused, between rounds
 * and after the end. It goes off only on a bout not started, a locked bout,
 * and an Event that is over (its results are frozen).
 */
describe('protestButtonLive', () => {
  const live = (boutStatus: string, over: { lockedAt?: string | null; eventOver?: boolean } = {}) =>
    protestButtonLive({ boutStatus, lockedAt: null, eventOver: false, ...over });

  it('is off on a bout not started', () => {
    expect(live('scheduled')).toBe(false);
  });

  it.each(['running', 'paused', 'completed'])('is live on a %s bout', (status) => {
    expect(live(status)).toBe(true);
  });

  it.each(['scheduled', 'running', 'paused', 'completed'])(
    'is off on a locked %s bout',
    (status) => {
      expect(live(status, { lockedAt: '2026-11-17T10:00:00.000Z' })).toBe(false);
    },
  );

  it.each(['running', 'paused', 'completed'])(
    'is off on a %s bout of an Event that is over',
    (status) => {
      expect(live(status, { eventOver: true })).toBe(false);
    },
  );

  it('is off on a voided bout', () => {
    expect(live('voided')).toBe(false);
  });
});
