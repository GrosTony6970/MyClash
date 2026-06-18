import { describe, expect, it } from 'vitest';
import { showReconnecting } from './show-reconnecting';

describe('showReconnecting', () => {
  it('shows the banner for a disconnected live match', () => {
    expect(showReconnecting(false, 'running')).toBe(true);
    expect(showReconnecting(false, 'paused')).toBe(true);
    expect(showReconnecting(false, 'scheduled')).toBe(true);
  });

  it('never shows it for a finished match (completed / voided)', () => {
    expect(showReconnecting(false, 'completed')).toBe(false);
    expect(showReconnecting(false, 'voided')).toBe(false);
  });

  it('never shows it while connected', () => {
    expect(showReconnecting(true, 'running')).toBe(false);
    expect(showReconnecting(true, 'completed')).toBe(false);
  });
});
