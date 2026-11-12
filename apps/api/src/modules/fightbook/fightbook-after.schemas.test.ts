/**
 * The after-the-spar bodies, through their exported schemas: a Zod pipe never runs on a direct
 * handler call. `fightbook_review` answers a null or out-of-range star, or a text over 500, with a
 * raw constraint error (a 5xx), so the schema must refuse each before the call.
 */
import { describe, expect, it } from 'vitest';
import { noteSchema, reviewSchema, thanksQuerySchema } from './fightbook-after.controller';

describe('reviewSchema', () => {
  it('takes 1 to 5 stars, a trimmed text, signed or anonymous', () => {
    expect(reviewSchema.parse({ stars: 1, anonymous: true })).toEqual({
      stars: 1,
      anonymous: true,
    });
    expect(reviewSchema.parse({ stars: 5, text: '  Great bout \n', anonymous: false })).toEqual({
      stars: 5,
      text: 'Great bout',
      anonymous: false,
    });
    expect(
      reviewSchema.safeParse({ stars: 3, text: 'x'.repeat(500), anonymous: false }).success,
    ).toBe(true);
  });

  it.each([
    ['no stars', { anonymous: false }],
    ['null stars', { stars: null, anonymous: false }],
    ['0 stars', { stars: 0, anonymous: false }],
    ['6 stars', { stars: 6, anonymous: false }],
    ['half a star', { stars: 2.5, anonymous: false }],
    ['stars as text', { stars: '3', anonymous: false }],
    ['no anonymous', { stars: 3 }],
    ['a text over 500', { stars: 3, text: 'x'.repeat(501), anonymous: false }],
    ['a text of spaces, tabs and newlines', { stars: 3, text: ' \t\n\r ', anonymous: false }],
    ['an empty text', { stars: 3, text: '', anonymous: false }],
    ['an unknown key', { stars: 3, anonymous: false, subject: 'x' }],
  ])('refuses %s', (_label, body) => {
    expect(reviewSchema.safeParse(body).success).toBe(false);
  });
});

describe('noteSchema', () => {
  it('takes a trimmed text, or null to delete', () => {
    expect(noteSchema.parse({ body: ' Guard up ' })).toEqual({ body: 'Guard up' });
    expect(noteSchema.parse({ body: null })).toEqual({ body: null });
  });

  it.each([
    ['no body', {}],
    ['a blank body', { body: '\n\t ' }],
    ['a body over 500', { body: 'x'.repeat(501) }],
    ['an unknown key', { body: 'x', author: 'y' }],
  ])('refuses %s', (_label, body) => {
    expect(noteSchema.safeParse(body).success).toBe(false);
  });
});

describe('thanksQuerySchema', () => {
  it('reads a 0-based page, 0 by default, at most 500', () => {
    expect(thanksQuerySchema.parse({})).toEqual({ page: 0 });
    expect(thanksQuerySchema.parse({ page: '3' })).toEqual({ page: 3 });
    expect(thanksQuerySchema.safeParse({ page: '501' }).success).toBe(false);
    expect(thanksQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
    expect(thanksQuerySchema.safeParse({ page: '1', q: 'x' }).success).toBe(false);
  });
});
