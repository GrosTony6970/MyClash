import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_POLL_MS, boardFreshness, boardIsDegraded } from './board-freshness';

const T0 = 1_800_000_000_000;
const landed = { realtimeDisabled: false, lastUpdateAt: T0, now: T0 + 1_000 };

describe('boardFreshness', () => {
  it('is live while the channel is up', () => {
    expect(boardFreshness({ ...landed, channelStatus: 'SUBSCRIBED' })).toEqual({ kind: 'live' });
  });

  // The channel says nothing until its handshake ends: that is not "slower".
  it('is live while the channel has said nothing yet', () => {
    expect(boardFreshness({ ...landed, channelStatus: null })).toEqual({ kind: 'live' });
    // Before the first read too: a page one second into its load is not broken.
    expect(boardFreshness({ ...landed, channelStatus: null, lastUpdateAt: null })).toEqual({
      kind: 'live',
    });
    // The page's clock does not tick while it is not degraded: `now` stays 0.
    expect(boardFreshness({ ...landed, channelStatus: null, now: 0 })).toEqual({ kind: 'live' });
  });

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('says slower updates after %s', (status) => {
    expect(boardFreshness({ ...landed, channelStatus: status })).toEqual({
      kind: 'polling',
      pollMs: BOARD_POLL_MS,
    });
  });

  it('says not updating once three polls in a row have not landed', () => {
    const down = { ...landed, channelStatus: 'CHANNEL_ERROR' };
    expect(boardFreshness({ ...down, now: T0 + 3 * BOARD_POLL_MS }).kind).toBe('polling');
    expect(boardFreshness({ ...down, now: T0 + 3 * BOARD_POLL_MS + 1 })).toEqual({
      kind: 'stale',
      ageMs: 3 * BOARD_POLL_MS + 1,
    });
  });

  it('says so when the operator switched live updates off, whatever the channel said', () => {
    for (const channelStatus of [null, 'SUBSCRIBED', 'CLOSED']) {
      expect(boardFreshness({ ...landed, realtimeDisabled: true, channelStatus })).toEqual({
        kind: 'disabled',
        pollMs: BOARD_POLL_MS,
      });
    }
  });
});

describe('boardIsDegraded', () => {
  it('is false while the channel is up or has said nothing', () => {
    expect(boardIsDegraded({ realtimeDisabled: false, channelStatus: 'SUBSCRIBED' })).toBe(false);
    expect(boardIsDegraded({ realtimeDisabled: false, channelStatus: null })).toBe(false);
  });

  it('is true once the channel said it is down, or realtime is off', () => {
    expect(boardIsDegraded({ realtimeDisabled: false, channelStatus: 'TIMED_OUT' })).toBe(true);
    expect(boardIsDegraded({ realtimeDisabled: true, channelStatus: null })).toBe(true);
  });
});

/** The hook is not mounted by this suite: its wiring is read as text. */
describe('the live board asks these two rules', () => {
  const hook = readFileSync(join(__dirname, 'use-live-board.ts'), 'utf8');

  it('draws itself once a second only while it depends on its poll', () => {
    expect(hook).toContain('useSecondsWhile(boardIsDegraded({ realtimeDisabled, channelStatus }))');
  });

  it('stamps a read only when it landed', () => {
    expect(hook).toMatch(/if \(result\.ok\) \{\s+setState\(result\.data\);\s+setLastUpdateAt\(/);
    expect(hook.match(/setLastUpdateAt\(/g)).toHaveLength(1);
  });
});
