import { describe, expect, it } from 'vitest';
import { auditOutcome } from './audit-outcome';

/**
 * The Result of an audit row (ruling 914): only system actions record one, and a row that
 * records none shows a dash. The payloads below are the ones the system writers store
 * (`system-actions.service.ts`, `backups.service.ts`).
 */
describe('auditOutcome', () => {
  it.each([
    [
      'a restart that failed',
      'system.component.restart',
      { ok: false, exitCode: 1, timedOut: false },
      'failed',
    ],
    [
      'a restart that timed out',
      'system.component.restart',
      { ok: true, exitCode: null, timedOut: true },
      'failed',
    ],
    [
      'a restart that worked',
      'system.component.restart',
      { ok: true, exitCode: 0, timedOut: false },
      'succeeded',
    ],
    [
      'a prune that worked',
      'system.disk.prune',
      { ok: true, exitCode: 0, timedOut: false, freedBytes: 9 },
      'succeeded',
    ],
    [
      'a renewal that failed',
      'system.tls.renew',
      { ok: false, scheduled: false, exitCode: 2, timedOut: false },
      'failed',
    ],
    // The runner answers before it restarts Traefik: nothing has renewed yet.
    [
      'a renewal that was scheduled',
      'system.tls.renew',
      { ok: true, scheduled: true, exitCode: null, timedOut: false },
      'started',
    ],
    ['a backup that started', 'system.backup.run', { status: 'running' }, 'started'],
    ['a backup the runner refused', 'system.backup.run', { status: 'failed' }, 'failed'],
  ] as const)('%s', (_name, action, payload, outcome) => {
    expect(auditOutcome(action, payload)).toBe(outcome);
  });

  it.each([
    ['an action outside system', 'event.update', { ok: false }],
    ['a system action with no outcome field', 'system.component.restart', { componentKey: 'x' }],
    ['a payload that is not an object', 'system.disk.prune', null],
    ['a payload that is an array', 'system.disk.prune', [{ ok: false }]],
    ['an ok that is not a boolean', 'system.disk.prune', { ok: 'false' }],
  ] as const)('%s: no outcome', (_name, action, payload) => {
    expect(auditOutcome(action, payload)).toBeNull();
  });
});
