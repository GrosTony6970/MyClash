import { describe, expect, it } from 'vitest';
import { PASSWORD_SPECIAL_CHARS, validatePassword } from './password';

describe('validatePassword', () => {
  it('rejects "password1234" (no uppercase, no special)', () => {
    const result = validatePassword('password1234');
    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(expect.arrayContaining(['uppercase', 'special']));
    expect(result.failing).not.toContain('length');
    expect(result.failing).not.toContain('digit');
    expect(result.failing).not.toContain('lowercase');
  });

  it('rejects "Password1234" (no special)', () => {
    const result = validatePassword('Password1234');
    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['special']);
  });

  it('rejects "Short1!" (length only)', () => {
    const result = validatePassword('Short1!');
    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['length']);
  });

  it('accepts "Password1234!" (all rules)', () => {
    const result = validatePassword('Password1234!');
    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
  });

  it('rejects whitespace as a special character', () => {
    // Narrowed from /[^A-Za-z0-9]/ to PASSWORD_SPECIAL_CHARS so the browser
    // checklist and GOTRUE_PASSWORD_REQUIRED_CHARACTERS cannot disagree —
    // GoTrue takes a finite list, and a space is not in it.
    const result = validatePassword('Password 1234');
    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['special']);
  });

  it('rejects a non-ASCII symbol as a special character', () => {
    const result = validatePassword('Motdepassé1234');
    expect(result.failing).toContain('special');
  });

  it('rejects ":" as a special character — it is GoTrue\'s group delimiter', () => {
    const result = validatePassword('Password:1234');
    expect(result.failing).toEqual(['special']);
  });

  it('accepts every character the shared set declares', () => {
    for (const special of PASSWORD_SPECIAL_CHARS) {
      const result = validatePassword(`Password123${special}`);
      expect(result.ok, `${special} must satisfy the special rule`).toBe(true);
    }
  });

  it('excludes ":" from the set, so the GoTrue group can be expressed', () => {
    expect(PASSWORD_SPECIAL_CHARS).not.toContain(':');
    expect(PASSWORD_SPECIAL_CHARS).toHaveLength(31);
  });

  it('rejects exactly 11 characters with every class', () => {
    const result = validatePassword('Pass123word');
    expect(result.failing).toEqual(expect.arrayContaining(['length', 'special']));
  });
});
