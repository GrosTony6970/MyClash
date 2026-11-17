import { describe, it, expect } from 'vitest';
import { inkOnHex, legibleOn, outlineInkOn, sideColorsFor, sideStyle } from './side-color';

describe('inkOnHex', () => {
  // The organiser types this hex. White was the fixed ink of the brand preview pill, and on a
  // light brand colour it could not be read (known-deviations D26).
  it.each([
    ['#ffffff', '#000000'],
    ['#eab308', '#000000'],
    ['#f59e0b', '#000000'],
    ['#22c55e', '#000000'],
    ['#b91c1c', '#ffffff'],
    ['#1d4ed8', '#ffffff'],
    ['#0f172a', '#ffffff'],
  ])('on %s the ink is %s', (fill, ink) => {
    expect(inkOnHex(fill)).toBe(ink);
  });

  it('takes dark ink on a value it cannot parse, as on the mid grey that value is treated as', () => {
    expect(inkOnHex('not-a-colour')).toBe('#000000');
  });
});

describe('outlineInkOn', () => {
  const SIDES = ['red', 'blue'] as const;

  // The scoring pad's default (hybrid) theme paints on dark. This must not
  // move: it is what every existing tablet renders today.
  it.each(SIDES)('keeps the established filled-pairing ink on dark (%s)', (side) => {
    const style = sideStyle(null, side);
    expect(outlineInkOn(style, 'dark')).toBe(style.text);
  });

  // style.text is near-white because it is meant to sit on style.panel. On an
  // outline control there is no panel, so on a light pad it lands on the page
  // — measured at 1.17:1 in the browser before this existed.
  it.each(SIDES)('uses the side colour, not the panel ink, on light (%s)', (side) => {
    const style = sideStyle(null, side);
    expect(outlineInkOn(style, 'light')).not.toBe(style.text);
    expect(outlineInkOn(style, 'light')).toBe(style.border);
  });

  it('still clamps a near-white configured colour on light', () => {
    const white = sideStyle(
      { display: { sideColors: { red: 'white', blue: 'blue' } } } as never,
      'red',
    );
    expect(outlineInkOn(white, 'light')).toBe('#1f2937');
  });
});

describe('legibleOn, on a light surface', () => {
  // Every side colour an organiser can pick. Yellow, green and orange passed through unchanged and
  // were 2.8:1 to 3.4:1 as a score on the organiser's match page (known-deviations D30).
  const TOKENS = [
    'white',
    'black',
    'grey',
    'yellow',
    'red',
    'blue',
    'green',
    'brown',
    'pink',
    'orange',
    'purple',
  ] as const;
  const PAGE = '#fafaf9';
  const ratio = (a: string, b: string) => {
    const lum = (hex: string) => {
      const [r, g, b2] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each(TOKENS)('reads as text on the light page: %s', (token) => {
    const ink = legibleOn(sideStyle(withSidesFor(token), 'red').border, 'light');
    expect(ratio(ink, PAGE)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves a colour that already reads untouched', () => {
    for (const token of ['red', 'blue', 'purple', 'brown'] as const) {
      const border = sideStyle(withSidesFor(token), 'red').border;
      expect(legibleOn(border, 'light')).toBe(border);
    }
  });

  it('keeps the hue when it darkens: yellow stays a yellow-brown, not a grey', () => {
    const ink = legibleOn('#ca8a04', 'light');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('returns a value it cannot parse unchanged', () => {
    expect(legibleOn('not-a-hex', 'light')).toBe('not-a-hex');
  });
});

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
    const dark = sideColorsFor(withSides('green', 'yellow'), 'dark');
    expect(dark.red).toBe('#16a34a');
    expect(dark.blue).toBe('#ca8a04');
    // On light the same hues, darkened until they read as text (D30).
    const light = sideColorsFor(withSides('green', 'yellow'), 'light');
    expect(light.red).toBe('#12823b');
    expect(light.blue).toBe('#9a6903');
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
