import { describe, expect, it } from 'vitest';
import { validatePassword } from './password';

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

  it('accepts whitespace as a special character', () => {
    const result = validatePassword('Password 1234');
    expect(result.ok).toBe(true);
  });

  it('rejects exactly 11 characters with every class', () => {
    const result = validatePassword('Pass123word');
    expect(result.failing).toEqual(expect.arrayContaining(['length', 'special']));
  });
});
