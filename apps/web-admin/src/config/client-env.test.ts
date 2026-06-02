import { afterEach, describe, expect, it } from 'vitest';
import { optionalClientEnv, requireClientEnv } from './client-env';

// Next.js's bundled types declare `process.env.NODE_ENV` as read-only.
// At runtime it's a plain string property — cast to the mutable shape
// so the test can set it.
const env = process.env as Record<string, string | undefined>;

const KEY = 'NEXT_PUBLIC_TEST_CLIENT_ENV';

describe('requireClientEnv', () => {
  const originalEnv = env[KEY];
  const originalNodeEnv = env['NODE_ENV'];

  afterEach(() => {
    if (originalEnv === undefined) delete env[KEY];
    else env[KEY] = originalEnv;
    if (originalNodeEnv === undefined) delete env['NODE_ENV'];
    else env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns the env value when set, regardless of NODE_ENV', () => {
    env[KEY] = 'https://scoring.example';
    env['NODE_ENV'] = 'production';
    expect(requireClientEnv(KEY, 'fallback')).toBe('https://scoring.example');
  });

  it('returns the dev fallback when unset and NODE_ENV is not production', () => {
    delete env[KEY];
    env['NODE_ENV'] = 'development';
    expect(requireClientEnv(KEY, 'http://localhost:3002')).toBe('http://localhost:3002');
  });

  it('throws with the var name + Dockerfile hint when unset in production', () => {
    delete env[KEY];
    env['NODE_ENV'] = 'production';
    expect(() => requireClientEnv(KEY, 'fallback')).toThrow(/NEXT_PUBLIC_TEST_CLIENT_ENV/);
    expect(() => requireClientEnv(KEY, 'fallback')).toThrow(/Dockerfile/);
  });
});

describe('optionalClientEnv', () => {
  const originalEnv = env[KEY];

  afterEach(() => {
    if (originalEnv === undefined) delete env[KEY];
    else env[KEY] = originalEnv;
  });

  it('returns undefined when unset, regardless of NODE_ENV', () => {
    delete env[KEY];
    env['NODE_ENV'] = 'production';
    expect(optionalClientEnv(KEY)).toBeUndefined();
  });

  it('returns the value when set', () => {
    env[KEY] = 'foo';
    expect(optionalClientEnv(KEY)).toBe('foo');
  });
});
