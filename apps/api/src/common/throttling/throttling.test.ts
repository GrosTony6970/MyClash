import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_THROTTLER,
  ThrottleByEmail,
  authEmailTracker,
  skipAuthEmailThrottle,
} from './throttle-by-email';
import { isThrottleWhitelisted, throttleWhitelist } from './throttle-whitelist';

class Fixture {
  @ThrottleByEmail()
  login(): void {}

  plain(): void {}
}

function context(opts: {
  ip?: string;
  body?: unknown;
  handler?: (...args: never[]) => unknown;
}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip: opts.ip, body: opts.body }) }),
    getHandler: () => opts.handler ?? Fixture.prototype.login,
  } as unknown as ExecutionContext;
}

const ORIGINAL = process.env.THROTTLE_IP_WHITELIST;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.THROTTLE_IP_WHITELIST;
  else process.env.THROTTLE_IP_WHITELIST = ORIGINAL;
});

describe('throttleWhitelist', () => {
  it('parses a comma-separated list, tolerating whitespace and blanks', () => {
    process.env.THROTTLE_IP_WHITELIST = ' 10.0.0.1 , ,10.0.0.2,';
    expect([...throttleWhitelist()]).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('is empty when unset, so nothing is exempt by default', () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    expect(throttleWhitelist().size).toBe(0);
  });

  it('re-reads when the env value changes rather than caching the first call', () => {
    // It is read lazily so ConfigModule's .env load still lands; that only helps
    // if a later change is actually picked up.
    process.env.THROTTLE_IP_WHITELIST = '10.0.0.1';
    expect(throttleWhitelist().has('10.0.0.1')).toBe(true);
    process.env.THROTTLE_IP_WHITELIST = '10.0.0.2';
    expect(throttleWhitelist().has('10.0.0.1')).toBe(false);
    expect(throttleWhitelist().has('10.0.0.2')).toBe(true);
  });
});

describe('isThrottleWhitelisted', () => {
  it('matches on req.ip', () => {
    process.env.THROTTLE_IP_WHITELIST = '10.0.0.1';
    expect(isThrottleWhitelisted(context({ ip: '10.0.0.1' }))).toBe(true);
    expect(isThrottleWhitelisted(context({ ip: '10.0.0.9' }))).toBe(false);
  });

  it('never exempts anyone when the whitelist is empty', () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    expect(isThrottleWhitelisted(context({ ip: '10.0.0.1' }))).toBe(false);
    expect(isThrottleWhitelisted(context({ ip: undefined }))).toBe(false);
  });
});

describe('authEmailTracker', () => {
  it('buckets an address case- and whitespace-insensitively', () => {
    const a = authEmailTracker({ body: { email: 'Fencer@Example.COM' } });
    const b = authEmailTracker({ body: { email: '  fencer@example.com ' } });
    expect(a).toBe(b);
  });

  it('separates distinct addresses', () => {
    expect(authEmailTracker({ body: { email: 'a@example.com' } })).not.toBe(
      authEmailTracker({ body: { email: 'b@example.com' } }),
    );
  });

  it('hashes, so the store never holds a raw address', () => {
    const tracker = authEmailTracker({ body: { email: 'fencer@example.com' } });
    expect(tracker).not.toContain('fencer@example.com');
    expect(tracker).toBe(createHash('sha256').update('fencer@example.com').digest('hex'));
  });

  it('survives raw, unvalidated bodies (guards run before the validation pipe)', () => {
    expect(() => authEmailTracker({ body: { email: 42 } })).not.toThrow();
    expect(() => authEmailTracker({ body: undefined })).not.toThrow();
    expect(() => authEmailTracker({})).not.toThrow();
  });
});

describe('skipAuthEmailThrottle', () => {
  it('counts a marked route carrying an email', () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    expect(skipAuthEmailThrottle(context({ body: { email: 'a@example.com' } }))).toBe(false);
  });

  it('skips routes not marked @ThrottleByEmail', () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    expect(
      skipAuthEmailThrottle(
        context({ body: { email: 'a@example.com' }, handler: Fixture.prototype.plain }),
      ),
    ).toBe(true);
  });

  it('skips when there is no usable email, leaving the 400 to the validation pipe', () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    expect(skipAuthEmailThrottle(context({ body: {} }))).toBe(true);
    expect(skipAuthEmailThrottle(context({ body: { email: '' } }))).toBe(true);
    expect(skipAuthEmailThrottle(context({ body: { email: 99 } }))).toBe(true);
  });

  it('honours the IP whitelist, which a per-throttler skipIf does NOT inherit', () => {
    // ThrottlerGuard resolves `namedThrottler.skipIf || commonOptions.skipIf`,
    // so this replaces the module-level whitelist check rather than composing.
    process.env.THROTTLE_IP_WHITELIST = '10.0.0.1';
    expect(
      skipAuthEmailThrottle(context({ ip: '10.0.0.1', body: { email: 'a@example.com' } })),
    ).toBe(true);
    expect(
      skipAuthEmailThrottle(context({ ip: '10.0.0.9', body: { email: 'a@example.com' } })),
    ).toBe(false);
  });
});

describe('AUTH_EMAIL_THROTTLER', () => {
  it('has a stable name — it keys the storage bucket and the Retry-After suffix', () => {
    expect(AUTH_EMAIL_THROTTLER).toBe('auth-email');
  });
});
