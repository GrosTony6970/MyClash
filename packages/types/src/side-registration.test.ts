import { describe, expect, it } from 'vitest';
import { isSideRegistration } from './side-registration';

describe('isSideRegistration', () => {
  it('matches a row of the side’s Fighter, and no other', () => {
    expect(isSideRegistration('reg-red', 'reg-red')).toBe(true);
    expect(isSideRegistration('reg-blue', 'reg-red')).toBe(false);
  });

  // A side waiting for a Fighter has no Registration: null is nobody.
  it('matches nothing for a side with no Registration, a row with none included', () => {
    expect(isSideRegistration(null, null)).toBe(false);
    expect(isSideRegistration(undefined, null)).toBe(false);
    expect(isSideRegistration('reg-red', null)).toBe(false);
  });
});
