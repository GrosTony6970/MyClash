import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionalClientEnv, requireClientEnv } from './client-env';

// Next.js's bundled types declare `process.env.NODE_ENV` as read-only.
// At runtime it's a plain string property — cast to the mutable shape
// so the test can set it.
const env = process.env as Record<string, string | undefined>;

describe('requireClientEnv', () => {
  const originalNodeEnv = env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete env['NODE_ENV'];
    else env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns the env value when set, regardless of NODE_ENV', () => {
    env['NODE_ENV'] = 'production';
    expect(requireClientEnv('https://scoring.example', 'NEXT_PUBLIC_TEST_VAR', 'fallback')).toBe(
      'https://scoring.example',
    );
  });

  it('returns the dev fallback when unset and NODE_ENV is not production', () => {
    env['NODE_ENV'] = 'development';
    expect(requireClientEnv(undefined, 'NEXT_PUBLIC_TEST_VAR', 'http://localhost:3002')).toBe(
      'http://localhost:3002',
    );
  });

  it('treats an empty-string value as missing', () => {
    env['NODE_ENV'] = 'development';
    expect(requireClientEnv('', 'NEXT_PUBLIC_TEST_VAR', 'http://localhost:3002')).toBe(
      'http://localhost:3002',
    );
  });

  it('logs a console.error with the var name + Dockerfile hint AND returns the dev fallback when unset in production', () => {
    // Throwing inside a client component nukes the whole route via
    // the React error boundary with no diagnostic visible to the
    // user (operator hit this on /pools and /bracket on 2026-06-02).
    // The right behaviour is: log loudly so operators see the
    // diagnostic in the browser console / Sentry, AND keep the page
    // running with the dev fallback so every other feature still
    // works — only the cross-app scoring link is broken.
    env['NODE_ENV'] = 'production';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = requireClientEnv(
        undefined,
        'NEXT_PUBLIC_TEST_CLIENT_ENV',
        'http://localhost:3002',
      );
      expect(result).toBe('http://localhost:3002');
      expect(consoleError).toHaveBeenCalledTimes(1);
      const message = String(consoleError.mock.calls[0]?.[0] ?? '');
      expect(message).toMatch(/NEXT_PUBLIC_TEST_CLIENT_ENV/);
      expect(message).toMatch(/Dockerfile/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('optionalClientEnv', () => {
  it('returns undefined when unset', () => {
    expect(optionalClientEnv(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(optionalClientEnv('')).toBeUndefined();
  });

  it('returns the value when set', () => {
    expect(optionalClientEnv('foo')).toBe('foo');
  });
});
