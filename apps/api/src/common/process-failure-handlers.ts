import { Logger } from '@nestjs/common';

export interface ProcessFailureLogger {
  error(message: string, trace?: string): void;
}

export type ProcessFailureReporter = (
  reason: unknown,
  context: { type: 'unhandledRejection' | 'uncaughtException'; message: string },
) => void;

let handlersRegistered = false;

export function describeProcessFailure(reason: unknown): { message: string; trace?: string } {
  if (reason instanceof Error) {
    return {
      message: reason.message || reason.name,
      trace: reason.stack,
    };
  }

  return {
    message: typeof reason === 'string' ? reason : (JSON.stringify(reason) ?? String(reason)),
  };
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

export function registerProcessFailureHandlers(
  logger = new Logger('Process'),
  reporter?: ProcessFailureReporter,
): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    logUnhandledRejection(reason, logger, reporter);
  });

  process.on('uncaughtException', (error) => {
    logUncaughtException(error, logger, reporter);
    process.exit(1);
  });
}
