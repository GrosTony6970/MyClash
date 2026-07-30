import { describe, it, expect } from 'vitest';
import { legibleOn, sideColorsFor, sideStyle } from './side-color';

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

describe('sideColorsFor', () => {
  const withSides = (red: string, blue: string) =>
    ({ display: { sideColors: { red, blue } } }) as never;

  it('paints the colours the organiser configured, not red and blue', () => {
    const { red, blue } = sideColorsFor(withSides('green', 'yellow'), 'light');
    expect(red).toBe('#16a34a');
    expect(blue).toBe('#ca8a04');
  });

  it('keeps a black side visible on the dark projector stage', () => {
    expect(sideColorsFor(withSides('black', 'white'), 'dark').red).toBe('#e2e8f0');
  });

  it('keeps a white side visible on the light public page', () => {
    expect(sideColorsFor(withSides('black', 'white'), 'light').blue).toBe('#1f2937');
  });

  it("falls back to each side's own token before the config loads", () => {
    const { red, blue } = sideColorsFor(null, 'light');
    expect(red).toBe('#dc2626');
    expect(blue).toBe('#2563eb');
  });
});

describe('sideStyle', () => {
  // `scoring_config_json` is free-form JSONB, so a hand-edited row or an older
  // client can put anything in `sideColors`. Every caller reads `.border` off
  // the result without a null check, so an unknown token used to crash the
  // surface rather than degrade it.
  it('falls back to the side token when the configured colour is not in the palette', () => {
    const style = sideStyle(
      { display: { sideColors: { red: 'cyan', blue: 'blue' } } } as never,
      'red',
    );
    expect(style.token).toBe('red');
    expect(style.border).toBe('#dc2626');
  });

  it('resolves every configured token in the palette', () => {
    expect(sideStyle(withSidesFor('purple'), 'red').token).toBe('purple');
    expect(sideStyle(withSidesFor('grey'), 'red').token).toBe('grey');
    expect(sideStyle(withSidesFor('brown'), 'red').token).toBe('brown');
    expect(sideStyle(withSidesFor('pink'), 'red').token).toBe('pink');
  });
});

const withSidesFor = (red: string) => ({ display: { sideColors: { red, blue: 'blue' } } }) as never;
