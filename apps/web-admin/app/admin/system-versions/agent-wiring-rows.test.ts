import { describe, expect, it } from 'vitest';
import {
  agentTileStatus,
  agentWakeRows,
  agentWatcherRows,
  type AgentWakeReading,
  type AgentWatcherReading,
} from './agent-wiring-rows';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const K = 'admin.systemVersions.runtimeHealth.agent';
const time = (iso: string) => `at ${iso}`;
type WakeState = Extract<AgentWakeReading, { read: 'ok' }>['state'];
const state: WakeState = {
  config: 'configured',
  checkedAt: 'C',
  lastFiredAt: null,
  lastStatus: null,
};

type WatcherState = Extract<AgentWatcherReading, { read: 'ok' }>['state'];
const pinging: WatcherState = {
  config: 'configured',
  checkedAt: 'C',
  lastOkAt: 'O',
  failing: false,
};
const watcherOff: AgentWatcherReading = { read: 'not_checked' };

describe('agentTileStatus', () => {
  it('the wake-up: grey when off or not seen, a warning when half-set, unreadable or a call failed', () => {
    const ok = (s: Partial<typeof state>) =>
      agentTileStatus({ read: 'ok', state: { ...state, ...s } }, watcherOff);
    expect(agentTileStatus({ read: 'not_checked' }, watcherOff)).toBe('not_configured');
    expect(agentTileStatus({ read: 'unreadable' }, watcherOff)).toBe('warning');
    expect(ok({ config: 'not_configured' })).toBe('not_configured');
    expect(ok({ config: 'misconfigured' })).toBe('warning');
    expect(ok({})).toBe('healthy');
    expect(ok({ lastFiredAt: 'F', lastStatus: 200 })).toBe('healthy');
    expect(ok({ lastFiredAt: 'F', lastStatus: 400 })).toBe('warning');
    expect(ok({ lastFiredAt: 'F', lastStatus: null })).toBe('warning');
  });

  it('the watcher: pinging is healthy, a failing ping or an unreadable state a warning', () => {
    const wakeOff: AgentWakeReading = { read: 'not_checked' };
    const w = (s: Partial<WatcherState>) =>
      agentTileStatus(wakeOff, { read: 'ok', state: { ...pinging, ...s } });
    expect(w({})).toBe('healthy');
    expect(w({ failing: true })).toBe('warning');
    expect(w({ config: 'not_configured' })).toBe('not_configured');
    expect(agentTileStatus(wakeOff, { read: 'unreadable' })).toBe('warning');
  });
});

describe('agentWatcherRows', () => {
  it('pinging, with the last answered ping', () => {
    expect(agentWatcherRows(t, { read: 'ok', state: pinging }, time)).toEqual([
      [`${K}.watcher`, `${K}.pinging {"time":"at O"}`],
    ]);
  });

  it('a failing ping is a warning; off and unseen are plain', () => {
    const failing = { ...pinging, failing: true };
    expect(agentWatcherRows(t, { read: 'ok', state: failing }, time)).toEqual([
      [`${K}.watcher`, `${K}.pingFailed {"time":"at C"}`, 'warning'],
    ]);
    const off = { ...pinging, config: 'not_configured' as const };
    expect(agentWatcherRows(t, { read: 'ok', state: off }, time)).toEqual([
      [`${K}.watcher`, `${K}.notConfigured`],
    ]);
    expect(agentWatcherRows(t, watcherOff, time)).toEqual([[`${K}.watcher`, `${K}.notChecked`]]);
  });
});

describe('agentWakeRows', () => {
  it('not checked yet, or unreadable', () => {
    expect(agentWakeRows(t, { read: 'not_checked' }, time)).toEqual([
      [`${K}.wake`, `${K}.notChecked`],
    ]);
    expect(agentWakeRows(t, { read: 'unreadable' }, time)).toEqual([
      [`${K}.wake`, `${K}.unreadable`, 'warning'],
    ]);
  });

  it('not configured; misconfigured is a warning', () => {
    const ok = (config: 'not_configured' | 'misconfigured') =>
      agentWakeRows(t, { read: 'ok', state: { ...state, config } }, time);
    expect(ok('not_configured')).toEqual([[`${K}.wake`, `${K}.notConfigured`]]);
    expect(ok('misconfigured')).toEqual([[`${K}.wake`, `${K}.misconfigured`, 'warning']]);
  });

  it('configured: when the worker last looked, and no call yet', () => {
    expect(agentWakeRows(t, { read: 'ok', state }, time)).toEqual([
      [`${K}.wake`, `${K}.configured {"time":"at C"}`],
      [`${K}.lastCall`, `${K}.noCallYet`],
    ]);
  });

  it('configured: the last call, its answer, or that it did not answer', () => {
    const called = (lastStatus: number | null) =>
      agentWakeRows(t, { read: 'ok', state: { ...state, lastFiredAt: 'F', lastStatus } }, time)[1];
    expect(called(200)).toEqual([`${K}.lastCall`, `${K}.callAt {"time":"at F","answer":"200"}`]);
    expect(called(null)).toEqual([
      `${K}.lastCall`,
      `${K}.callAt {"time":"at F","answer":"${K}.noAnswer"}`,
    ]);
  });
});
