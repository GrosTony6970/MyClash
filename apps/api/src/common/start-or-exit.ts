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
    // Each step on its own: a step that throws skips none of the others, and never the exit, the
    // one thing this path owes (Docker's restart is its trace).
    let failure: { message: string; trace?: string } = { message: 'an undescribable failure' };
    try {
      failure = describeProcessFailure(reason);
    } catch {
      // Described by the words above.
    }
    try {
      logger.error(`The API did not start: ${failure.message}`, failure.trace);
    } catch {
      // The report below still goes.
    }
    try {
      report(reason, { type: 'start', message: failure.message });
    } catch {
      // The exit below still comes.
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
