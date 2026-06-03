import { describe, expect, it } from 'vitest';
import { nextSlugFromName, slugify } from './slug-from-name';

describe('slugify', () => {
  it('lowercases + replaces non-alphanumerics with dashes + trims dashes', () => {
    expect(slugify('Halberd Counter Cut!')).toBe('halberd-counter-cut');
  });

  it('returns empty string for an empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('nextSlugFromName', () => {
  it('seeds the slug from the new name when no prior slug exists', () => {
    // First keystroke. The empty-prev-slug branch generates from the
    // new typed value so the slug pops into existence on key 1.
    expect(nextSlugFromName('', '', 'Halberd')).toBe('halberd');
  });

  it('keeps tracking the name across subsequent keystrokes (regression: lock-after-one-letter)', () => {
    // The shipping bug: `f.slug || slugify(newName)` froze the slug
    // at the first letter because the auto-generated 'h' was non-empty.
    // Mirror the event-wizard pattern that compares against
    // slugify(prevName) so auto-tracking survives past keystroke 1.
    expect(nextSlugFromName('h', 'H', 'Ha')).toBe('ha');
  });

  it('locks the slug once the operator manually edits it away from the auto-track', () => {
    // After the operator overrides 'halberd' with 'my-workshop',
    // typing more letters in the name field must leave the slug
    // alone. The diverged slug stays verbatim.
    expect(nextSlugFromName('my-workshop', 'Ha', 'Hal')).toBe('my-workshop');
  });

  it('clears the slug to empty when the operator clears the name while still tracking', () => {
    // While auto-tracking, slugify('') === '' propagates through.
    expect(nextSlugFromName('halberd', 'Halberd', '')).toBe('');
  });
});
