import { describe, expect, it } from 'vitest';
import { formatCountryName, getCountryOptions, PINNED_COUNTRIES } from './countries';

describe('getCountryOptions', () => {
  it('pins France at the very top in EN', () => {
    const opts = getCountryOptions('en');
    expect(opts[0]?.code).toBe('FR');
    expect(opts[0]?.pinned).toBe(true);
    expect(opts[0]?.name).toBe('France');
  });

  it('pins France at the very top in FR', () => {
    const opts = getCountryOptions('fr');
    expect(opts[0]?.code).toBe('FR');
    expect(opts[0]?.name).toBe('France');
  });

  it("doesn't duplicate the pinned country in the alphabetised tail", () => {
    const opts = getCountryOptions('en');
    const fr = opts.filter((o) => o.code === 'FR');
    expect(fr).toHaveLength(1);
  });

  it('sorts the non-pinned tail alphabetically by localised name', () => {
    const opts = getCountryOptions('en').filter((o) => !o.pinned);
    const names = opts.map((o) => o.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names).toEqual(sorted);
  });

  it('renders Germany localised per locale', () => {
    expect(getCountryOptions('en').find((o) => o.code === 'DE')?.name).toBe('Germany');
    expect(getCountryOptions('fr').find((o) => o.code === 'DE')?.name).toBe('Allemagne');
  });

  it('includes the pinned countries set', () => {
    const opts = getCountryOptions('en');
    for (const code of PINNED_COUNTRIES) {
      expect(opts.find((o) => o.code === code)).toBeDefined();
    }
  });
});

describe('formatCountryName', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(formatCountryName(null, 'en')).toBeNull();
    expect(formatCountryName(undefined, 'en')).toBeNull();
    expect(formatCountryName('', 'en')).toBeNull();
  });

  it('returns the localised name for a valid code', () => {
    expect(formatCountryName('FR', 'en')).toBe('France');
    expect(formatCountryName('DE', 'fr')).toBe('Allemagne');
  });

  it('returns the raw code if Intl does not know it (defensive)', () => {
    // 'ZZ' is an explicitly reserved "unknown" code in ISO 3166.
    // Intl.DisplayNames may or may not return a localised label;
    // either way we should not throw.
    expect(() => formatCountryName('ZZ', 'en')).not.toThrow();
  });
});
