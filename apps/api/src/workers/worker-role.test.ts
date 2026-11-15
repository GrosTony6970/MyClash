import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import { BullRegistrar } from '@nestjs/bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchAutoLockService } from '../modules/matches/match-auto-lock.service';
import { startWorker, startWorkerRole, type StartedWorker } from './worker-role';

/**
 * What the `--worker` process starts (rulings 807-809). Without `register()` the worker would be
 * a healthy container with no queue consumer, and production would run no job at all: the api
 * starts none (`manualRegistration`, workers.module.ts).
 */
function fakeJobs(register = vi.fn()) {
  const start = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn((token: unknown) => {
    if (token === BullRegistrar) return { register };
    if (token === MatchAutoLockService) return { start };
    throw new Error(`unexpected token ${String(token)}`);
  });
  return { context: { get, close } as unknown as INestApplicationContext, register, start };
}

describe('startWorkerRole', () => {
  it('starts the queue consumers and the auto-lock scan, once each', async () => {
    const jobs = fakeJobs();
    await startWorkerRole(jobs.context);
    expect(jobs.register).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('fails the start when a consumer cannot be registered (register() throws, it never rejects)', async () => {
    const jobs = fakeJobs(
      vi.fn(() => {
        throw new Error('probe-marker-processor');
      }),
    );
    await expect(startWorkerRole(jobs.context)).rejects.toThrow('probe-marker-processor');
  });
});

describe('startWorker', () => {
  let started: StartedWorker | undefined;

  afterEach(async () => {
    await started?.health.close();
    started = undefined;
    vi.restoreAllMocks();
  });

  it('starts the jobs, then serves /health alone on 127.0.0.1', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const jobs = fakeJobs();
    started = await startWorker(() => Promise.resolve(jobs.context), 0);

    expect(jobs.register).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledTimes(1);
    const address = started.health.getHttpServer().address() as { address: string; port: number };
    expect(address.address).toBe('127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
    // A route of the API: the worker does not serve it.
    expect((await fetch(`${base}/api/v1/version`)).status).toBe(404);
  });

  it('is written the way the tests above run it', () => {
    const source = readFileSync(join(__dirname, 'worker-role.ts'), 'utf8');
    expect(source.split('await startWorkerRole(jobs);').length - 1).toBe(1);
    expect(source).toContain("await health.listen(port, '127.0.0.1');");
    expect(source).not.toContain('0.0.0.0');
    expect(source).toContain('{ abortOnError: false },');
  });
});
