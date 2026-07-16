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
  // A per-throttler skipIf REPLACES the module-level one rather than composing
  // with it (throttler.guard: `namedThrottler.skipIf || commonOptions.skipIf`),
  // so the whitelist check has to be repeated here.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_BY_EMAIL, context.getHandler()) !== true) return true;
  // No email to key on — let the validation pipe reject it as a 400 rather than
  // bucketing every malformed request together.
  return requestEmail(context.switchToHttp().getRequest<{ body?: unknown }>()) === '';
}
