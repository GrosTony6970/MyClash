import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { OperationalUnavailableException } from '../../common/operational-exception';

/**
 * Turning an ops-runner failure response into the exception the browser should
 * see. Kept beside the service rather than inside it: this is transport
 * translation, and the service is already at the file-size budget.
 */

export interface OpsRunnerError {
  message: string;
  /** A refusal the screen words itself (e.g. `upload_changed`); null for the others. */
  code: string | null;
  /** The numbers a refusal names (`receivedBytes`, `maxBytes`, `freeBytes`…); null for none. */
  details: Record<string, unknown> | null;
}

/**
 * The runner answers `{ "error": "…", "code"?: "…", "details"?: {…} }`. Reading it as raw text put
 * the JSON envelope itself into the message the operator saw.
 */
export async function readOpsRunnerError(response: Response): Promise<OpsRunnerError> {
  const text = await response.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { error?: unknown }).error === 'string'
    ) {
      const { error, code, details } = parsed as {
        error: string;
        code?: unknown;
        details?: unknown;
      };
      return {
        message: error,
        code: typeof code === 'string' ? code : null,
        details:
          details && typeof details === 'object' ? (details as Record<string, unknown>) : null,
      };
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return { message: text, code: null, details: null };
}

/** A coded refusal keeps its status class; anything else the runner answers is its fault (503). */
const CODED_REFUSALS: Record<number, new (body: object) => HttpException> = {
  400: BadRequestException,
  404: NotFoundException,
  409: ConflictException,
  413: PayloadTooLargeException,
};

/**
 * Relay the runner's status class instead of flattening everything to 503.
 * Lock contention is the operator's answer ("something is already running"),
 * not a server fault, and reads very differently in the UI. A refusal's code
 * becomes the problem+json `code`, and its numbers are SPREAD into the body: the
 * exception filter copies every other key of the body into `details`, so a
 * nested `details` key would arrive as `details.details` and the screen would
 * read nothing.
 */
export function opsRunnerException(
  status: number,
  { message, code, details }: OpsRunnerError,
): HttpException {
  const Refusal = CODED_REFUSALS[status];
  // The numbers first: none of them may overwrite the message or the code.
  if (code && Refusal) return new Refusal({ ...details, message, code });
  if (status === 409) return new ConflictException(message || 'The ops runner is busy.');
  if (status === 400) {
    return new BadRequestException(message || 'The ops runner rejected the request.');
  }
  return new OperationalUnavailableException(
    message || `Ops runner request failed with ${status}.`,
  );
}
