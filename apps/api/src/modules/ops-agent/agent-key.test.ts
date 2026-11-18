import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashAgentKey, isAgentKey } from './agent-key';

const VALID = `mca_${'a'.repeat(43)}`;

describe('isAgentKey', () => {
  it('accepts the prefix and 43 base64url characters', () => {
    expect(isAgentKey(VALID)).toBe(true);
    expect(isAgentKey(`mca_${'Az09-_'.repeat(7)}x`)).toBe(true);
  });

  it('refuses a login token, a wrong length, a space and an empty value', () => {
    expect(isAgentKey('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig')).toBe(false);
    expect(isAgentKey(`mca_${'a'.repeat(42)}`)).toBe(false);
    expect(isAgentKey(`mca_${'a'.repeat(44)}`)).toBe(false);
    expect(isAgentKey(`mca_${'a'.repeat(42)} `)).toBe(false);
    expect(isAgentKey('')).toBe(false);
  });
});

describe('hashAgentKey', () => {
  it('is the sha256 hex of the raw key', () => {
    expect(hashAgentKey('mca_x')).toBe(createHash('sha256').update('mca_x').digest('hex'));
  });
});
