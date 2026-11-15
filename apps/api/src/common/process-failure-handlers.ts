import { Logger } from '@nestjs/common';

export interface ProcessFailureLogger {
  error(message: string, trace?: string): void;
}

export type ProcessFailureReporter = (
  reason: unknown,
  context: { type: 'unhandledRejection' | 'uncaughtException' | 'start'; message: string },
) => void;

/** Sends the error reports already captured, waiting at most `ms`. */
export type ReportFlush = (ms: number) => Promise<unknown>;

/** How long a dying process waits for its error reports to leave (Sentry's own fatal path: 2 s). */
export const FLUSH_BEFORE_EXIT_MS = 2_000;

let handlersRegistered = false;

export function describeProcessFailure(reason: unknown): { message: string; trace?: string } {
  if (reason instanceof Error) {
    return {
      message: reason.message || reason.name,
      trace: reason.stack,
    };
  }

  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    // A circular value or a BigInt: JSON.stringify throws, and so can String() (no prototype).
    return { message: Object.prototype.toString.call(reason) };
  }
}

export function logUnhandledRejection(
  reason: unknown,
  logger: ProcessFailureLogger,
  reporter?: ProcessFailureReporter,
): void {
  const failure = describeProcessFailure(reason);
  logger.error(`Unhandled promise rejection: ${failure.message}`, failure.trace);
  reporter?.(reason, { type: 'unhandledRejection', message: failure.message });
}

export function logUncaughtException(
  error: unknown,
  logger: ProcessFailureLogger,
  reporter?: ProcessFailureReporter,
): void {
  const failure = describeProcessFailure(error);
  logger.error(`Uncaught exception: ${failure.message}`, failure.trace);
  reporter?.(error, { type: 'uncaughtException', message: failure.message });
}

/**
 * Waits for the error reports to leave, then ends the process with code 1. The report is sent in
 * the background, so an exit straight after it can drop it. A flush that fails or hangs still
 * ends the process within `ms`.
 */
export async function flushThenExit(
  flush: ReportFlush,
  exit: (code: number) => void,
  ms = FLUSH_BEFORE_EXIT_MS,
): Promise<void> {
  let bound: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.resolve()
      .then(() => flush(ms))
      .catch(() => undefined),
    new Promise<void>((resolve) => {
      bound = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(bound);
  exit(1);
}

/** An exception nothing caught: logged, reported, then the process ends once the report left. */
export function onUncaughtException(
  error: unknown,
  logger: ProcessFailureLogger,
  reporter: ProcessFailureReporter | undefined,
  flush: ReportFlush,
  exit: (code: number) => void,
): Promise<void> {
  logUncaughtException(error, logger, reporter);
  return flushThenExit(flush, exit);
}

export function registerProcessFailureHandlers(
  logger = new Logger('Process'),
  reporter?: ProcessFailureReporter,
  flush: ReportFlush = async () => undefined,
): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    logUnhandledRejection(reason, logger, reporter);
  });

  process.on('uncaughtException', (error) => {
    void onUncaughtException(error, logger, reporter, flush, (code) => process.exit(code));
  });
}
