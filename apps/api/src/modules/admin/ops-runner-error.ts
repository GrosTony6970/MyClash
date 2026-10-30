import { BadRequestException, ConflictException } from '@nestjs/common';
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
}

/**
 * The runner answers `{ "error": "…", "code"?: "…" }`. Reading it as raw text put the JSON
 * envelope itself into the message the operator saw.
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
      const { error, code } = parsed as { error: string; code?: unknown };
      return { message: error, code: typeof code === 'string' ? code : null };
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return { message: text, code: null };
}

/**
 * Relay the runner's status class instead of flattening everything to 503.
 * Lock contention is the operator's answer ("something is already running"),
 * not a server fault, and reads very differently in the UI. A refusal's code
 * becomes the problem+json `code`.
 */
export function opsRunnerException(
  status: number,
  { message, code }: OpsRunnerError,
): HttpException {
  if (status === 409) return new ConflictException(message || 'The ops runner is busy.');
  if (status === 400) {
    const reason = message || 'The ops runner rejected the request.';
    return new BadRequestException(code ? { message: reason, code } : reason);
  }
  return new OperationalUnavailableException(
    message || `Ops runner request failed with ${status}.`,
  );
}
