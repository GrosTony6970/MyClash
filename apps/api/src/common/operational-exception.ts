import { ServiceUnavailableException } from '@nestjs/common';

/**
 * A 5xx whose message is written FOR the operator and is safe to show them.
 *
 * `ApiExceptionFilter` scrubs every >=500 body to "Internal server error",
 * which is right for unexpected faults — an exception message can carry a
 * stack, a query, a connection string. But it also silently ate the messages
 * we author deliberately ("Backup operations require the ops runner", the
 * ops-runner's own failure text), leaving the admin UI with nothing to show
 * but a generic string. That is how a delete-all failure stayed undiagnosable.
 *
 * This marker is the opt-in: the filter keeps the message for this class only.
 * Everything else — including a plain `ServiceUnavailableException` — stays
 * scrubbed, so the exemption cannot widen by accident when someone throws a
 * generic 5xx from new code.
 *
 * Only throw it with text you would be happy to render in a browser.
 */
export class OperationalUnavailableException extends ServiceUnavailableException {}
