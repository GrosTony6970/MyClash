import { describe, expect, it } from 'vitest';
import { UsersAdminController } from './users.controller';

function throttleLimit(methodName: keyof UsersAdminController): unknown {
  return Reflect.getMetadata('THROTTLER:LIMITglobal', UsersAdminController.prototype[methodName]);
}

describe('UsersAdminController throttling', () => {
  it('uses a higher read limit for the super-admin users grid', () => {
    expect(throttleLimit('list')).toBe(600);
  });
});
