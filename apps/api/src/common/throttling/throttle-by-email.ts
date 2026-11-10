import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the email-keyed throttler registered in AppModule. */
export const AUTH_EMAIL_THROTTLER = 'auth-email';

const THROTTLE_BY_EMAIL = 'throttle:by-email';

/**
 * Opts a route into the email-keyed auth throttler. Every configured throttler
 * runs on every route, so the throttler skips anything without this marker —
 * otherwise routes carrying no email would all share one bucket and 429 each
 * other.
 */
export const ThrottleByEmail = (): CustomDecorator => SetMetadata(THROTTLE_BY_EMAIL, true);

function requestEmail(req: { body?: unknown }): string {
  // Guards run before the validation pipe, so this is raw input: it may be
  // absent or any type. Supabase treats addresses case-insensitively, so
  // normalize or `A@b.c` and `a@b.c` would get an allowance each.
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
}

/** Hashed so the in-memory throttler store never holds a raw address. */
export function authEmailTracker(req: Record<string, unknown>): string {
  return createHash('sha256').update(requestEmail(req)).digest('hex');
}

export function skipAuthEmailThrottle(context: ExecutionContext): boolean {
  return skipUnlessMarked(context, THROTTLE_BY_EMAIL);
}

/**
 * The doors that MAIL an address (sign-up, the mail link) count per address on their own
 * throttler, never on the sign-in one (rulings 569, 570). Shared, ten mail-link requests for Bob's
 * address by a stranger shut Bob out of every password sign-in for an hour; apart, the stranger
 * can only stop the mails, which is the flood this limit is for.
 */
export const AUTH_MAIL_THROTTLER = 'auth-mail';

const THROTTLE_MAIL_BY_EMAIL = 'throttle:mail-by-email';

export const ThrottleMailByEmail = (): CustomDecorator => SetMetadata(THROTTLE_MAIL_BY_EMAIL, true);

export function skipAuthMailThrottle(context: ExecutionContext): boolean {
  return skipUnlessMarked(context, THROTTLE_MAIL_BY_EMAIL);
}

function skipUnlessMarked(context: ExecutionContext, marker: string): boolean {
  // A per-throttler skipIf REPLACES the module-level one rather than composing
  // with it (throttler.guard: `namedThrottler.skipIf || commonOptions.skipIf`),
  // so the whitelist check has to be repeated here.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(marker, context.getHandler()) !== true) return true;
  // No email to key on — let the validation pipe reject it as a 400 rather than
  // bucketing every malformed request together.
  return requestEmail(context.switchToHttp().getRequest<{ body?: unknown }>()) === '';
}
