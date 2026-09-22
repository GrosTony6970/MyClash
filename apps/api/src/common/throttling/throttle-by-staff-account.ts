import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isThrottleWhitelisted } from './throttle-whitelist';
import { normalizeStaffUsername } from '../../modules/staff/normalize-username';

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

/** Case-folding for the event half, which is an id or a slug, not a username. */
const lowerTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * The bucket identity: one event, one username.
 *
 * Keyed on `eventId` when the body carries one, else on `eventSlugOrCode` —
 * the same order `StaffService.login` resolves the event in (operator ruling
 * 52). Keying on the slug alone let a caller send the real id with a made-up
 * slug on every attempt: sign-in ignored that slug, so each spelling of it was
 * a fresh allowance against the same account. Resolving slug → id here instead
 * would mean a database round-trip inside a guard, before the caller has
 * authenticated.
 *
 * Residual: the id path and the `?event=<slug>` QR path are two buckets, so a
 * caller who knows both gets 20 attempts an hour instead of 10. That is still
 * 360× tighter than the 7,200 the global per-IP limit permits on its own.
 *
 * Never `req.ip`: an entire venue shares one NAT address on tournament day, so
 * an IP bucket would ban a hall full of referees while a distributed attacker
 * stayed under it. This bounds one account across all IPs, which is the only
 * thing credential stuffing has to respect.
 */
function staffAccountKey(req: { body?: unknown }): string {
  // Guards run before the validation pipe, so this is raw input: it may be
  // absent or any type. The username goes through the SAME normalizer the
  // account lookup uses, so no spelling the lookup accepts can be a bucket of
  // its own; the event half is case-folded because Postgres reads a uuid in
  // either case and `Open-2026` and `open-2026` must not get an allowance each.
  const body = req.body as
    { eventId?: unknown; eventSlugOrCode?: unknown; username?: unknown } | undefined;
  const event = lowerTrimmed(body?.eventId) || lowerTrimmed(body?.eventSlugOrCode);
  const username = normalizeStaffUsername(body?.username);
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
