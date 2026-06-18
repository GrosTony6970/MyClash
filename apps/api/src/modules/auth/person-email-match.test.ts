import { describe, expect, it } from 'vitest';
import { personEmailMatchesUser } from './person-email-match';

describe('personEmailMatchesUser', () => {
  it('matches identical emails', () => {
    expect(personEmailMatchesUser('a@b.com', 'a@b.com')).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(personEmailMatchesUser('  A@B.com ', 'a@b.COM')).toBe(true);
  });

  it('does not match different emails', () => {
    expect(personEmailMatchesUser('a@b.com', 'c@d.com')).toBe(false);
  });

  it('never matches when either side is empty/missing', () => {
    expect(personEmailMatchesUser('', 'a@b.com')).toBe(false);
    expect(personEmailMatchesUser('a@b.com', '')).toBe(false);
    expect(personEmailMatchesUser(null, null)).toBe(false);
    expect(personEmailMatchesUser('   ', 'a@b.com')).toBe(false);
  });
});
