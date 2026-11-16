import type { INestApplicationContext } from '@nestjs/common';

/** The signals Docker (`docker stop`) and a terminal (Ctrl+C) send to end the process. */
export const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * On a stop signal, Nest closes the app (ruling 811): the queue consumers finish the job in
 * flight (@nestjs/bullmq closes each Worker, which waits for its job), the auto-lock timer stops,
 * the HTTP server stops taking requests; then the process exits 0.
 *
 * Without it, Node ran as the container's PID 1 with no handler, which ignores SIGTERM: Docker
 * killed the process at the end of its grace period, the job in flight with it, and BullMQ handed
 * the job out again ~30 s later, or failed it when cut twice (maxStalledCount 1).
 *
 * `useProcessExit`: after its shutdown Nest otherwise sends the signal to itself again, which PID 1
 * ignores too, and the process would wait for every socket to close. One owner per process: two
 * listeners would each exit when their own (shorter) shutdown ends, killing the job in flight.
 *
 * It also records that the stop began (`isStopping`): a stopping worker closes its idle queue
 * consumers first, and its health monitor must not read that as a dead worker (ruling 830). The
 * listener only records; the exit stays Nest's. It is added here, never when the file is
 * imported: an import must not change how any process, a test runner included, answers SIGTERM.
 * `signals` is a seam for tests, which emit on a fake.
 */
export function enableGracefulStop(
  app: Pick<INestApplicationContext, 'enableShutdownHooks'>,
  signals: Pick<NodeJS.EventEmitter, 'once'> = process,
): void {
  for (const signal of STOP_SIGNALS) signals.once(signal, () => (stopping = true));
  app.enableShutdownHooks([...STOP_SIGNALS], { useProcessExit: true });
}

let stopping = false;

/** Whether this process got a stop signal: its consumers are closing, on purpose. */
export function isStopping(): boolean {
  return stopping;
}
