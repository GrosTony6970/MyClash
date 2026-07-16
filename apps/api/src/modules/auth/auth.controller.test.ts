import { describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller';

function throttleLimit(methodName: keyof AuthController): unknown {
  return Reflect.getMetadata('THROTTLER:LIMITglobal', AuthController.prototype[methodName]);
}

function throttleTtl(methodName: keyof AuthController): unknown {
  return Reflect.getMetadata('THROTTLER:TTLglobal', AuthController.prototype[methodName]);
}

function throttledByEmail(methodName: keyof AuthController): unknown {
  return Reflect.getMetadata('throttle:by-email', AuthController.prototype[methodName]);
}

describe('AuthController throttling', () => {
  it('keeps magic-link and password login on the strict one-hour auth limit', () => {
    expect(throttleLimit('requestMagicLink')).toBe(10);
    expect(throttleTtl('requestMagicLink')).toBe(3_600_000);
    expect(throttleLimit('passwordLogin')).toBe(10);
    expect(throttleTtl('passwordLogin')).toBe(3_600_000);
  });

  it('throttles both login surfaces by email, not just by IP', () => {
    // The per-IP limit bounds one IP across all accounts; only the per-email
    // limit bounds one account across many IPs (distributed credential stuffing).
    expect(throttledByEmail('passwordLogin')).toBe(true);
    expect(throttledByEmail('publicLogin')).toBe(true);
  });

  it('leaves non-login routes off the email throttler', () => {
    // Routes without an email in the body would otherwise all share one bucket.
    expect(throttledByEmail('publicPasswordResetConfirm')).toBeUndefined();
    expect(throttledByEmail('acceptOAuthSession')).toBeUndefined();
  });
});
