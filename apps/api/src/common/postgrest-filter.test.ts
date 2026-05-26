import { describe, expect, it } from 'vitest';
import { sanitizePostgrestFilterValue } from './postgrest-filter';

describe('sanitizePostgrestFilterValue', () => {
  it('passes legitimate names through unchanged', () => {
    expect(sanitizePostgrestFilterValue('Dupont')).toBe('Dupont');
    expect(sanitizePostgrestFilterValue('Jean-Paul')).toBe('Jean-Paul');
    expect(sanitizePostgrestFilterValue("O'Brien")).toBe("O'Brien");
    expect(sanitizePostgrestFilterValue('Élise Müller')).toBe('Élise Müller');
  });

  it('preserves the ilike wildcards % and _', () => {
    expect(sanitizePostgrestFilterValue('Du%')).toBe('Du%');
    expect(sanitizePostgrestFilterValue('D_pont')).toBe('D_pont');
  });

  it('strips the four PostgREST .or() meta-characters', () => {
    // A comma would let the user introduce a sibling filter clause.
    expect(sanitizePostgrestFilterValue('evil,is_admin.eq.true')).toBe('evilis_admin.eq.true');
    // Parens are part of `.in(...)` and group syntax.
    expect(sanitizePostgrestFilterValue('foo(bar)')).toBe('foobar');
    // `*` is PostgREST's `select=*` wildcard; not allowed inside ilike values.
    expect(sanitizePostgrestFilterValue('a*b')).toBe('ab');
    // Backslash is the escape character.
    expect(sanitizePostgrestFilterValue('a\\b')).toBe('ab');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizePostgrestFilterValue('  Dupont  ')).toBe('Dupont');
  });

  it('reduces a fully malicious payload to a safe substring', () => {
    // Worst-case payload: every meta-character + a sibling filter.
    const out = sanitizePostgrestFilterValue('a,b(c)d*e\\f');
    expect(out).toBe('abcdef');
    // No meta-character survives.
    expect(/[,()*\\]/.test(out)).toBe(false);
  });

  it('returns empty string when input is only meta-characters', () => {
    expect(sanitizePostgrestFilterValue(',()*\\')).toBe('');
    expect(sanitizePostgrestFilterValue('   ')).toBe('');
  });
});
