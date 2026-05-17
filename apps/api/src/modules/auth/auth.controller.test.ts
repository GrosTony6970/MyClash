import { describe, expect, it } from 'vitest';
import { AuthController } from './auth.controller';

function throttleLimit(methodName: keyof AuthController): unknown {
  return Reflect.getMetadata('THROTTLER:LIMITglobal', AuthController.prototype[methodName]);
}

function throttleTtl(methodName: keyof AuthController): unknown {
  return Reflect.getMetadata('THROTTLER:TTLglobal', AuthController.prototype[methodName]);
}

describe('AuthController throttling', () => {
  it('keeps magic-link and password login on the strict one-hour auth limit', () => {
    expect(throttleLimit('requestMagicLink')).toBe(10);
    expect(throttleTtl('requestMagicLink')).toBe(3_600_000);
    expect(throttleLimit('passwordLogin')).toBe(10);
    expect(throttleTtl('passwordLogin')).toBe(3_600_000);
  });
});
