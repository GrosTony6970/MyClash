import type { INestApplicationContext } from '@nestjs/common';
import { BullRegistrar } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { fastifyAdapterOptions } from '../common/fastify-adapter-options';
import { MatchAutoLockService } from '../modules/matches/match-auto-lock.service';
import { WorkerHealthModule } from './worker-health.module';

/** The two parts of a started worker, for whoever stops it. */
export interface StartedWorker {
  jobs: INestApplicationContext;
  health: NestFastifyApplication;
}

/**
 * What only the worker runs (rulings 808, 809): the queue consumers, which the API's graph
 * builds but does not start (`manualRegistration`, workers.module.ts), and the auto-lock scan.
 * `register()` is synchronous: a bad processor class throws here, and the start fails.
 */
export async function startWorkerRole(jobs: Pick<INestApplicationContext, 'get'>): Promise<void> {
  jobs.get(BullRegistrar).register();
  jobs.get(MatchAutoLockService).start();
}

/**
 * The `--worker` process (common/process-role.ts). `createJobs` builds the API's whole graph with
 * no HTTP (main.ts passes `NestFactory.createApplicationContext(AppModule, …)`, so this file loads
 * no AppModule). Then the jobs start, and a second, tiny app serves `/health` alone on
 * 127.0.0.1 (ruling 807): the image's HEALTHCHECK reaches it from inside the container, and
 * nothing on the network reaches the worker at all.
 */
export async function startWorker(
  createJobs: () => Promise<INestApplicationContext>,
  port: number,
): Promise<StartedWorker> {
  const jobs = await createJobs();
  await startWorkerRole(jobs);
  const health = await NestFactory.create<NestFastifyApplication>(
    WorkerHealthModule,
    // No request line per probe: the HEALTHCHECK asks every 30 s.
    new FastifyAdapter(fastifyAdapterOptions({ logger: false })),
    { abortOnError: false },
  );
  await health.listen(port, '127.0.0.1');
  console.info(
    `MyClash worker started: the queue consumers and the auto-lock run here; /health on 127.0.0.1:${port}`,
  );
  return { jobs, health };
}
