import { describe, expect, it } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';

describe('expectNoRawIds', () => {
  it('passes names and slugs', () => {
    expect(() => expectNoRawIds({ events: [{ name: 'FAL', slug: 'fal-2026' }] })).not.toThrow();
  });

  it('refuses a UUID in a value, however deep', () => {
    const id = '00000001-aaaa-4bbb-8ccc-000000000001';
    expect(() => expectNoRawIds({ events: [{ tournaments: [{ ref: id }] }] })).toThrow();
  });

  it('refuses a UUID in a key', () => {
    const id = '00000001-AAAA-4bbb-8ccc-000000000001';
    expect(() => expectNoRawIds({ [id]: 'x' })).toThrow();
  });
});
