import { PASSWORD_MIN_LENGTH, PASSWORD_SPECIAL_CHARS, validatePassword } from '@myclash/types';
import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './temp-password';

/**
 * The old generator was `randomBytes(18).toString('base64url')` and was
 * exempted from the policy. Once GoTrue started enforcing the same rules the
 * exemption stopped being affordable: base64url's only punctuation is `-` and
 * `_`, so 46.7% of values carried no special character. These tests exist to
 * keep the replacement's guarantee from quietly regressing to that.
 */
const ITERATIONS = 1000;

describe('generateTemporaryPassword', () => {
  it('satisfies the shared password policy every single time', () => {
    const failures: string[][] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const validation = validatePassword(generateTemporaryPassword());
      if (!validation.ok) failures.push(validation.failing);
    }
    expect(failures, `${failures.length}/${ITERATIONS} generated passwords failed`).toEqual([]);
  });

  it('is long enough for the floor and for the length the admin console pins', () => {
    for (let i = 0; i < 100; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(24);
      expect(password.length).toBeGreaterThan(20);
      expect(password.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    }
  });

  it('draws its special character only from the set GoTrue is configured with', () => {
    // A character outside PASSWORD_SPECIAL_CHARS would pass our own rule only
    // if the rule drifted, and would be rejected by GoTrue regardless.
    for (let i = 0; i < 200; i += 1) {
      for (const char of generateTemporaryPassword()) {
        const known =
          /[a-z]/.test(char) ||
          /[A-Z]/.test(char) ||
          /[0-9]/.test(char) ||
          PASSWORD_SPECIAL_CHARS.includes(char);
        expect(known, `${char} is outside every declared pool`).toBe(true);
      }
    }
  });

  it('does not put the guaranteed characters in a fixed order', () => {
    // Without the shuffle the first four characters would always be
    // lower/upper/digit/special, which is a pattern an attacker gets for free.
    const firstIsLower = new Set<boolean>();
    for (let i = 0; i < 200; i += 1) {
      firstIsLower.add(/[a-z]/.test(generateTemporaryPassword()[0] as string));
    }
    expect(firstIsLower).toEqual(new Set([true, false]));
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < ITERATIONS; i += 1) seen.add(generateTemporaryPassword());
    expect(seen.size).toBe(ITERATIONS);
  });
});
