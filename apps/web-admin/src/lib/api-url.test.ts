import { afterEach, describe, expect, it } from 'vitest';
import { getPublicApiUrl } from './api-url';

const ORIGINAL = process.env['NEXT_PUBLIC_API_URL'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['NEXT_PUBLIC_API_URL'];
  else process.env['NEXT_PUBLIC_API_URL'] = ORIGINAL;
});

describe('getPublicApiUrl', () => {
  it('returns the configured URL', () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.test';
    expect(getPublicApiUrl()).toBe('https://api.example.test');
  });

  it('falls back to the local API when unset', () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    expect(getPublicApiUrl()).toBe('http://localhost:4000');
  });

  it('treats an empty or whitespace value as unset', () => {
    // A deploy that sets the var to '' would pass `??` and yield relative URLs
    // against the admin origin, which serves no API. This is the guard the 121
    // hand-rolled `?? 'http://localhost:4000'` reads did not have.
    process.env['NEXT_PUBLIC_API_URL'] = '';
    expect(getPublicApiUrl()).toBe('http://localhost:4000');
    process.env['NEXT_PUBLIC_API_URL'] = '   ';
    expect(getPublicApiUrl()).toBe('http://localhost:4000');
  });

  it('trims surrounding whitespace from a real value', () => {
    process.env['NEXT_PUBLIC_API_URL'] = '  https://api.example.test  ';
    expect(getPublicApiUrl()).toBe('https://api.example.test');
  });
});
