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
  // A venue's wifi is one address for the whole hall (rulings 569, 570).
  const VENUE_DOORS = [
    'publicSignup',
    'publicChoosePassword',
    'publicLogin',
    'passwordLogin',
    'requestMagicLink',
  ] as const;

  it('lets a whole hall through the sign-up, choose-password and sign-in doors: 60 an hour per network', () => {
    for (const door of VENUE_DOORS) {
      expect([door, throttleLimit(door)]).toEqual([door, 60]);
      expect([door, throttleTtl(door)]).toEqual([door, 3_600_000]);
    }
  });

  it('keeps the password reset at 5 an hour and its confirmation at 10', () => {
    expect(throttleLimit('publicPasswordReset')).toBe(5);
    expect(throttleLimit('publicPasswordResetConfirm')).toBe(10);
  });

  it('throttles every door that takes an address by email, not just by IP', () => {
    // The per-IP limit bounds one IP across all accounts; only the per-email
    // limit bounds one account across many IPs (distributed credential stuffing),
    // and one mailbox against a flood of sign-up or sign-in mails.
    for (const door of [
      'passwordLogin',
      'publicLogin',
      'publicSignup',
      'requestMagicLink',
    ] as const)
      expect([door, throttledByEmail(door)]).toEqual([door, true]);
  });

  it('leaves non-login routes off the email throttler', () => {
    // Routes without an email in the body would otherwise all share one bucket.
    expect(throttledByEmail('publicPasswordResetConfirm')).toBeUndefined();
    expect(throttledByEmail('acceptOAuthSession')).toBeUndefined();
  });
});
