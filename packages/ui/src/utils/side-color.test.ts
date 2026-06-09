import { describe, it, expect } from 'vitest';
import { legibleOn, sideStyle } from './side-color';

describe('legibleOn', () => {
  it('replaces a near-black colour with a light fallback on a dark surface', () => {
    // black token border (#334155) would be near-invisible as a score on
    // the dark stage → must clamp to a light colour.
    const black = sideStyle(
      { display: { sideColors: { red: 'black', blue: 'blue' } } } as never,
      'red',
    );
    expect(legibleOn(black.border, 'dark')).toBe('#e2e8f0');
  });

  it('replaces a near-white colour with a dark fallback on a light surface', () => {
    // white token border (#cbd5e1) would be near-invisible as a name on
    // the white header strip → must clamp to a dark colour.
    const white = sideStyle(
      { display: { sideColors: { red: 'white', blue: 'blue' } } } as never,
      'red',
    );
    expect(legibleOn(white.border, 'light')).toBe('#1f2937');
  });

  it('leaves a saturated mid-tone colour unchanged on both surfaces', () => {
    const red = sideStyle(null, 'red').border; // #dc2626
    expect(legibleOn(red, 'dark')).toBe(red);
    expect(legibleOn(red, 'light')).toBe(red);
  });
});
