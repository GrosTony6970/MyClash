import {
  describeProcessFailure,
  flushThenExit,
  type ProcessFailureLogger,
  type ProcessFailureReporter,
  type ReportFlush,
} from './process-failure-handlers';

/** A start that has not finished by then counts as failed: a healthy one takes a few seconds. */
export const START_TIMEOUT_MS = 60_000;

export interface StartOrExitOptions {
  logger: ProcessFailureLogger;
  report: ProcessFailureReporter;
  flush: ReportFlush;
  exit?: (code: number) => void;
  timeoutMs?: number;
}

/**
 * Runs the API's start, and ends the process when it fails or hangs: logged, reported, the report
 * given time to leave, exit 1, so Docker restarts the container. Without this a failed start only
 * logged, and the process lived on, deaf (the queue workers kept it running): Docker restarts a
 * process that exits, never one that is merely unhealthy.
 */
export async function startOrExit(
  start: () => Promise<void>,
  {
    logger,
    report,
    flush,
    exit = (code) => process.exit(code),
    timeoutMs = START_TIMEOUT_MS,
  }: StartOrExitOptions,
): Promise<void> {
  let over = false;
  // Read by `fail` only once set below: the bound's own callback or a failed start calls it.
  const fail = async (reason: unknown): Promise<void> => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    try {
      const failure = describeProcessFailure(reason);
      logger.error(`The API did not start: ${failure.message}`, failure.trace);
      report(reason, { type: 'start', message: failure.message });
    } catch {
      // A logger or a reporter that throws must not keep a failed start alive: the exit below is
      // the one thing this path owes, and Docker's restart is its trace.
    }
    await flushThenExit(flush, exit);
  };
  const timer = setTimeout(
    () => void fail(new Error(`The start did not finish within ${timeoutMs / 1000} s`)),
    timeoutMs,
  );
  try {
    await start();
  } catch (error) {
    await fail(error);
    return;
  }
  over = true;
  clearTimeout(timer);
}
