import { describe, expect, it } from 'vitest';
import { initialTab } from './initial-tab';

describe('the tab the sign-in page opens on', () => {
  it('opens sign-up for a Workshop page\'s "Create an account" (ruling 568)', () => {
    expect(initialTab('signup')).toBe('signup');
  });

  it('opens the reset tab for a spent sign-up link', () => {
    expect(initialTab('reset')).toBe('reset');
  });

  it.each([undefined, 'other', ['signup']])('opens sign-in for %j', (asked) => {
    expect(initialTab(asked)).toBe('signin');
  });
});
