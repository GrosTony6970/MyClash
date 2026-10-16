import {
  Injectable,
  UnauthorizedException,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { catchError, tap, throwError, type Observable } from 'rxjs';
import { STAFF_PIN_THROTTLE } from './throttle-profiles';
import { isThrottleWhitelisted } from './throttle-whitelist';
import { normalizeStaffUsername } from '../../modules/staff/normalize-username';

/**
 * Bounds the PIN sign-in of one staff account: ten wrong PINs an hour, then 429 until the
 * oldest is an hour old (operator, 2026-10-16, O3). A good PIN never counts.
 *
 * It did when this was a throttler guard. A guard runs before the PIN check and cannot see its
 * answer, so a referee who signed in again after each tablet reboot was refused at the eleventh
 * good PIN of the hour. An interceptor sees the answer: a 401 (a wrong PIN, or no such account)
 * keeps its place in the count, anything else gives it back.
 */
export const ThrottleByStaffAccount = (): MethodDecorator & ClassDecorator =>
  UseInterceptors(WrongPinCount);

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
 * would mean a database round-trip in front of the sign-in, before the caller
 * has authenticated.
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
  // Interceptors run before the validation pipe, so this is raw input: it may be
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

/**
 * The tries of the hour of each account, by the hash of its key, oldest first. Hashed so memory
 * never holds a raw username. Module state, not the interceptor's: every route that carries the
 * decorator shares one count per account, whichever module instantiates it.
 */
export interface TryStore {
  byBucket: Map<string, number[]>;
  /** When the store was last swept of the accounts whose hour is over. */
  sweptAt: number;
}
const tries: TryStore = { byBucket: new Map(), sweptAt: 0 };

/** Above this many accounts, a try sweeps the ones whose hour is over. */
export const SWEEP_ABOVE = 10_000;
/**
 * At most once a minute. A store of accounts still inside their hour stays above the bound after
 * a sweep: swept on every try, each sign-in scanned all of them, and a caller who sends wrong
 * PINs for made-up usernames (event ids are public) grew that cost at will.
 */
export const SWEEP_EVERY_MS = 60_000;

/** The account's tries still inside the hour, the same array each time: it is changed in place. */
export function triesOf(store: TryStore, bucket: string, now: number): number[] {
  const expired = now - STAFF_PIN_THROTTLE.ttl;
  if (store.byBucket.size > SWEEP_ABOVE && now - store.sweptAt >= SWEEP_EVERY_MS) {
    store.sweptAt = now;
    for (const [key, times] of store.byBucket) {
      if ((times.at(-1) ?? 0) <= expired) store.byBucket.delete(key);
    }
  }
  const times = store.byBucket.get(bucket) ?? [];
  while (times.length > 0 && times[0]! <= expired) times.shift();
  store.byBucket.set(bucket, times);
  return times;
}

/**
 * The race is ten wrong PINs sent at once. Counted on their answer, all ten would pass the check
 * before the first was refused. So a try takes its place when it starts, and gives it back when
 * its sign-in is answered with anything but a 401.
 */
@Injectable()
export class WrongPinCount implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (isThrottleWhitelisted(context)) return next.handle();
    const key = staffAccountKey(context.switchToHttp().getRequest<{ body?: unknown }>());
    // No account to key on: the validation pipe refuses it as a 400. Counted, every malformed
    // request would share one bucket.
    if (key === '') return next.handle();

    const now = Date.now();
    const times = triesOf(tries, createHash('sha256').update(key).digest('hex'), now);
    if (times.length >= STAFF_PIN_THROTTLE.limit) return throwError(() => new ThrottlerException());
    times.push(now);
    const giveBack = () => {
      const at = times.indexOf(now);
      if (at >= 0) times.splice(at, 1);
    };
    return next.handle().pipe(
      tap({ next: giveBack }),
      catchError((err: unknown) => {
        if (!(err instanceof UnauthorizedException)) giveBack();
        return throwError(() => err);
      }),
    );
  }
}
