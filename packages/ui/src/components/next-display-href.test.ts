import { describe, it, expect } from 'vitest';
import { nextDisplayHref } from './next-display-href';

describe('nextDisplayHref', () => {
  it('builds the web-public display URL by default', () => {
    expect(nextDisplayHref('spring-open', 'm-42')).toBe('/e/spring-open/match/m-42/display');
  });

  it('uses the override builder when provided (e.g. the admin /display route)', () => {
    expect(nextDisplayHref('', 'm-42', (id) => `/display/${id}`)).toBe('/display/m-42');
  });
});
