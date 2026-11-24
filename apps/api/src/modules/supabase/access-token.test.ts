import * as jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { signedByAuthServer } from './access-token';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';

describe('signedByAuthServer', () => {
  it('accepts a token signed with the secret', () => {
    expect(signedByAuthServer(jwt.sign({ sub: 'a' }, SECRET), SECRET)).toBe(true);
  });

  it('accepts an expired token: only the signature is asked', () => {
    const expired = jwt.sign({ sub: 'a' }, SECRET, { expiresIn: -60 });
    expect(signedByAuthServer(expired, SECRET)).toBe(true);
  });

  it('refuses a token signed with another secret', () => {
    expect(signedByAuthServer(jwt.sign({ sub: 'a' }, `${SECRET}-other`), SECRET)).toBe(false);
  });

  it('refuses an unsigned token, a garbage string and an empty secret', () => {
    expect(signedByAuthServer(jwt.sign({ sub: 'a' }, '', { algorithm: 'none' }), SECRET)).toBe(
      false,
    );
    expect(signedByAuthServer('junk', SECRET)).toBe(false);
    expect(signedByAuthServer(jwt.sign({ sub: 'a' }, SECRET), '')).toBe(false);
  });

  it('refuses a token signed with another algorithm', () => {
    expect(signedByAuthServer(jwt.sign({ sub: 'a' }, SECRET, { algorithm: 'HS512' }), SECRET)).toBe(
      false,
    );
  });
});
