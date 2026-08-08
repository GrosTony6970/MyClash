import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the staff-account-keyed throttler registered in AppModule. */
export const STAFF_PIN_THROTTLER = 'staff-pin';

const THROTTLE_BY_STAFF_ACCOUNT = 'throttle:by-staff-account';

/**
 * Opts a route into the staff-account-keyed throttler. Every configured
 * throttler runs on every route, so the throttler skips anything without this
 * marker — otherwise routes carrying no staff account would all share one
 * bucket and 429 each other.
 */
export const ThrottleByStaffAccount = (): CustomDecorator =>
  SetMetadata(THROTTLE_BY_STAFF_ACCOUNT, true);

/**
 * The bucket identity: one event, one username.
 *
 * Keyed on `eventSlugOrCode` rather than `eventId` because the slug is the
 * REQUIRED field (`staffLoginSchema`) and the id is optional — the login
 * picker sends both, the `?event=<slug>` QR deep link sends only the slug, so
 * the slug is the one value present on every path. Resolving slug → id here
 * would mean a database round-trip inside a guard, before the caller has
 * authenticated, which is a worse trade than the residual below.
 *
 * Residual: the field accepts an event's slug OR its code, so a caller who
 * knows both gets two allowances instead of one. 20 attempts an hour is still
 * 360× tighter than the 7,200 the global per-IP limit permits on its own.
 *
 * Never `req.ip`: an entire venue shares one NAT address on tournament day, so
 * an IP bucket would ban a hall full of referees while a distributed attacker
 * stayed under it. This bounds one account across all IPs, which is the only
 * thing credential stuffing has to respect.
 */
function staffAccountKey(req: { body?: unknown }): string {
  // Guards run before the validation pipe, so this is raw input: it may be
  // absent or any type. Both halves are lowercased because neither the event
  // lookup nor the username lookup is case-sensitive — without it, `Ref1` and
  // `ref1` would get an allowance each.
  const body = req.body as { eventSlugOrCode?: unknown; username?: unknown } | undefined;
  const event =
    typeof body?.eventSlugOrCode === 'string' ? body.eventSlugOrCode.trim().toLowerCase() : '';
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  // A partial key would bucket every malformed request together, so demand both.
  if (!event || !username) return '';
  return `${event}|${username}`;
}

/** Hashed so the in-memory throttler store never holds a raw username. */
export function staffAccountTracker(req: Record<string, unknown>): string {
  return createHash('sha256').update(staffAccountKey(req)).digest('hex');
}

export function skipStaffAccountThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf REPLACES the module-level one rather than composing
  // with it (throttler.guard: `namedThrottler.skipIf || commonOptions.skipIf`),
  // so the whitelist check has to be repeated here.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_BY_STAFF_ACCOUNT, context.getHandler()) !== true) return true;
  // No account to key on — let the validation pipe reject it as a 400 rather
  // than bucketing every malformed request together.
  return staffAccountKey(context.switchToHttp().getRequest<{ body?: unknown }>()) === '';
}
