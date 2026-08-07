import { BadRequestException, ConflictException } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { OperationalUnavailableException } from '../../common/operational-exception';

/**
 * Turning an ops-runner failure response into the exception the browser should
 * see. Kept beside the service rather than inside it: this is transport
 * translation, and the service is already at the file-size budget.
 */

/**
 * The runner answers `{ "error": "…" }`. Reading it as raw text put the JSON
 * envelope itself into the message the operator saw.
 */
export async function readOpsRunnerError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { error?: unknown }).error === 'string'
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return text;
}

/**
 * Relay the runner's status class instead of flattening everything to 503.
 * Lock contention is the operator's answer ("something is already running"),
 * not a server fault, and reads very differently in the UI.
 */
export function opsRunnerException(status: number, message: string): HttpException {
  if (status === 409) return new ConflictException(message || 'The ops runner is busy.');
  if (status === 400)
    return new BadRequestException(message || 'The ops runner rejected the request.');
  return new OperationalUnavailableException(
    message || `Ops runner request failed with ${status}.`,
  );
}
