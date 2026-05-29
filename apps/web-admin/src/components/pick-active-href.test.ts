import { describe, expect, it } from 'vitest';
import { pickActiveHref } from './pick-active-href';

describe('pickActiveHref', () => {
  it('does not highlight an exact-match item when the pathname is a sub-route', () => {
    const result = pickActiveHref('/org/x/events/abc/schedule', [
      { href: '/org/x' },
      { href: '/org/x/events', exact: true },
    ]);
    expect(result).toBe('/org/x');
  });

  it('still highlights an exact-match item on its own page', () => {
    const result = pickActiveHref('/org/x/events', [
      { href: '/org/x' },
      { href: '/org/x/events', exact: true },
    ]);
    expect(result).toBe('/org/x/events');
  });

  it('keeps prefix matching for non-exact items so sibling tabs highlight their parent', () => {
    const result = pickActiveHref('/org/x/rulesets/scoring', [{ href: '/org/x/rulesets' }]);
    expect(result).toBe('/org/x/rulesets');
  });
});
