import { afterEach, describe, expect, it } from 'vitest';
import { publicAppUrl } from './public-app-url';

const ORIGINAL = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'];
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['NEXT_PUBLIC_PUBLIC_APP_URL'];
  else process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] = ORIGINAL;
});

describe('publicAppUrl', () => {
  it('is the configured origin, trimmed, with no trailing slash', () => {
    process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] = '  https://app.example.test/  ';
    expect(publicAppUrl()).toBe('https://app.example.test');
  });

  it('is local dev’s own address when unset or blank, never production', () => {
    delete process.env['NEXT_PUBLIC_PUBLIC_APP_URL'];
    expect(publicAppUrl()).toBe('http://localhost:3001');
    process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] = '   ';
    expect(publicAppUrl()).toBe('http://localhost:3001');
  });
});
