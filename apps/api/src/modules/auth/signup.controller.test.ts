import { describe, expect, it } from 'vitest';
import { SignupController } from './signup.controller';

describe('SignupController throttling', () => {
  it('keeps organizer signup on the strict one-hour auth limit', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITglobal', SignupController.prototype.signup)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLglobal', SignupController.prototype.signup)).toBe(
      3_600_000,
    );
  });
});
