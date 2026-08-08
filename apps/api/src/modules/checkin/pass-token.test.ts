import { describe, expect, it } from 'vitest';
import { hashPassToken, looksLikePassToken, mintPassToken, passExpiryFor } from './pass-token';

describe('mintPassToken', () => {
  it('never returns the same token twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintPassToken()));
    expect(tokens.size).toBe(500);
  });

  it('is base64url — safe in a URL and dense in a QR symbol', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintPassToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries 32 bytes of entropy', () => {
    // base64url of 32 bytes is 43 chars with the padding dropped.
    expect(mintPassToken()).toHaveLength(43);
  });
});

describe('hashPassToken', () => {
  it('never returns the raw token — the whole point of the column', () => {
    const raw = mintPassToken();
    expect(hashPassToken(raw)).not.toBe(raw);
  });

  it('is sha256 hex, so it fits a TEXT UNIQUE column and indexes as an equality', () => {
    expect(hashPassToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable — the same token always resolves to the same row', () => {
    const raw = mintPassToken();
    expect(hashPassToken(raw)).toBe(hashPassToken(raw));
  });

  it('separates two tokens that differ by one character', () => {
    expect(hashPassToken('token-a')).not.toBe(hashPassToken('token-b'));
  });

  it('is plain sha256, pinned', () => {
    // A changed algorithm would orphan every pass already in the field — the
    // stored hashes stop matching and no QR resolves — and would do it
    // silently, because minting and verifying would still agree with each
    // other. This is the only assertion that would notice.
    expect(hashPassToken('myclash')).toBe(
      'f37857ff450332b4ca5ad44e10f8666eaddd936eab2842d04dc392e22993e5ef',
    );
  });
});

describe('looksLikePassToken', () => {
  it('accepts a freshly minted token', () => {
    expect(looksLikePassToken(mintPassToken())).toBe(true);
  });

  it('tolerates the whitespace a decoder can hand back', () => {
    expect(looksLikePassToken(` ${mintPassToken()} `)).toBe(true);
  });

  it.each([
    ['a URL', 'https://myclash.fr/e/fal-2026'],
    ['a wifi QR', 'WIFI:S:venue;T:WPA;P:hunter2;;'],
    ['a vCard', 'BEGIN:VCARD\nFN:Marie\nEND:VCARD'],
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(200)],
  ])('rejects %s without a database round trip', (_label, value) => {
    expect(looksLikePassToken(value)).toBe(false);
  });
});

describe('passExpiryFor', () => {
  it('is the event end plus seven days, matching a guest session', () => {
    const expiry = passExpiryFor('2026-08-09T00:00:00.000Z');
    expect(expiry).toBe('2026-08-16T00:00:00.000Z');
  });

  it('leaves an undated event unbounded rather than inventing a deadline', () => {
    expect(passExpiryFor(null)).toBeNull();
  });

  it('treats an unparseable date as undated instead of producing Invalid Date', () => {
    expect(passExpiryFor('not-a-date')).toBeNull();
  });

  it('accepts a bare date column, which is what events.end_date is', () => {
    expect(passExpiryFor('2026-08-09')).toBe('2026-08-16T00:00:00.000Z');
  });
});
