import { describe, expect, it } from 'vitest';
import { agentTileStatus, agentWakeRows, type AgentWakeReading } from './agent-wiring-rows';

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

describe('agentTileStatus', () => {
  it('grey when off or not seen, a warning when half-set, unreadable or a call failed', () => {
    const ok = (s: Partial<typeof state>) =>
      agentTileStatus({ read: 'ok', state: { ...state, ...s } });
    expect(agentTileStatus({ read: 'not_checked' })).toBe('not_configured');
    expect(agentTileStatus({ read: 'unreadable' })).toBe('warning');
    expect(ok({ config: 'not_configured' })).toBe('not_configured');
    expect(ok({ config: 'misconfigured' })).toBe('warning');
    expect(ok({})).toBe('healthy');
    expect(ok({ lastFiredAt: 'F', lastStatus: 200 })).toBe('healthy');
    expect(ok({ lastFiredAt: 'F', lastStatus: 400 })).toBe('warning');
    expect(ok({ lastFiredAt: 'F', lastStatus: null })).toBe('warning');
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
