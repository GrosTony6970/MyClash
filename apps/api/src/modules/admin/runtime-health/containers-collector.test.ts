import { describe, expect, it, vi } from 'vitest';
import { EXPECTED_SERVICES } from '../../ops-agent/expected-services';
import type { ContainerRow } from '../system-actions.service';
import {
  collectContainers,
  deadContainers,
  describeContainerProblem,
} from './containers-collector';

function row(service: string, state: string, exitCode: number | null, health: string | null) {
  return { name: `myclash-${service}`, service, state, health, status: 's', exitCode };
}

/** One running, healthy row per expected service: nothing is missing. */
function allRunning(): ContainerRow[] {
  return EXPECTED_SERVICES.map((service) => row(service, 'running', 0, 'healthy'));
}

describe('deadContainers (the same rule as the skill §4, ruling 900)', () => {
  it.each([
    ['running healthy', row('web-public', 'running', 0, 'healthy'), 0],
    ['running without a healthcheck', row('supabase-rest', 'running', 0, null), 0],
    ['running unhealthy', row('web-public', 'running', 0, 'unhealthy'), 1],
    ['exited 137 (killed)', row('web-public', 'exited', 137, null), 1],
    ['exited 1 (crashed)', row('web-public', 'exited', 1, null), 1],
    ['exited 0 (stopped on purpose)', row('web-public', 'exited', 0, null), 0],
    ['exited 143 (stopped on purpose)', row('supabase-studio', 'exited', 143, null), 0],
    ['created 1 (a failed start)', row('db', 'created', 1, null), 1],
    // Never started: nobody will start it (the 2026-11-20 restore left db "Created").
    ['created 0 (never started)', row('db', 'created', 0, null), 1],
    ['created with an unknown code', row('db', 'created', null, null), 1],
    ['restarting', row('worker', 'restarting', 1, null), 1],
    ['dead', row('worker', 'dead', null, null), 1],
    ['exited with an unknown code (the skill notes it)', row('worker', 'exited', null, null), 0],
  ])('%s', (_label, container, count) => {
    expect(deadContainers([container])).toHaveLength(count);
  });

  it('names the service, its state, its exit code and its health, and no other field', () => {
    expect(deadContainers([row('web-public', 'exited', 1, null)])).toEqual([
      { service: 'web-public', state: 'exited', exitCode: 1, health: null },
    ]);
  });
});

describe('describeContainerProblem', () => {
  it('reads as the service, then what is wrong', () => {
    const say = describeContainerProblem;
    expect(say({ service: 'web-public', state: 'exited', exitCode: 1, health: null })).toBe(
      'web-public exited 1',
    );
    expect(say({ service: 'api', state: 'running', exitCode: 0, health: 'unhealthy' })).toBe(
      'api unhealthy',
    );
    expect(say({ service: 'worker', state: 'restarting', exitCode: null, health: null })).toBe(
      'worker restarting',
    );
    expect(say({ service: 'db', state: 'missing', exitCode: null, health: null })).toBe(
      'db missing',
    );
  });
});

describe('collectContainers', () => {
  function actions(rows: ContainerRow[], available = true) {
    return {
      opsAvailable: vi.fn(() => available),
      getContainers: vi.fn(async () => ({ generatedAt: 'g', containers: rows })),
    };
  }

  it('is not configured, and reads nothing, without the ops runner', async () => {
    const systemActions = actions([], false);
    expect(await collectContainers(systemActions)).toEqual({ configured: false });
    expect(systemActions.getContainers).not.toHaveBeenCalled();
  });

  it('counts the running containers among all of them, and names no problem when all run', async () => {
    const rows = [...allRunning(), row('supabase-studio', 'exited', 143, null)];
    rows.splice(
      rows.findIndex((r) => r.service === 'supabase-studio'),
      1,
    );
    expect(await collectContainers(actions(rows))).toEqual({
      configured: true,
      running: EXPECTED_SERVICES.length - 1,
      total: EXPECTED_SERVICES.length,
      problems: [],
    });
  });

  it('names a dead container', async () => {
    const rows = allRunning().map((r) =>
      r.service === 'web-public' ? row('web-public', 'exited', 1, null) : r,
    );
    const reading = await collectContainers(actions(rows));
    expect(reading).toMatchObject({
      problems: [{ service: 'web-public', state: 'exited', exitCode: 1, health: null }],
    });
  });

  it('names an expected service that has no container at all as missing', async () => {
    const rows = allRunning().filter((r) => r.service !== 'web-marketing');
    const reading = await collectContainers(actions(rows));
    expect(reading).toMatchObject({
      problems: [{ service: 'web-marketing', state: 'missing', exitCode: null, health: null }],
    });
  });

  it('lets a failed read throw: the service maps it to unavailable', async () => {
    const systemActions = actions([]);
    systemActions.getContainers.mockRejectedValueOnce(new Error('runner down'));
    await expect(collectContainers(systemActions)).rejects.toThrow('runner down');
  });
});

describe('EXPECTED_SERVICES', () => {
  it('is every log service plus the two whose log the agent may not read', () => {
    expect(EXPECTED_SERVICES).toContain('db');
    expect(EXPECTED_SERVICES).toContain('supabase-meta');
    expect(EXPECTED_SERVICES).toContain('web-public');
    expect(EXPECTED_SERVICES).toHaveLength(16);
  });
});
