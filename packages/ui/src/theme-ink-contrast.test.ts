import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Ink on its surface, measured from the token values in theme.css.
 *
 * Two screens shipped with text nobody could read, and every gate was green: the ghost button was
 * white on a white card (known-deviations D13), and the display wall wrote the page's dark ink on
 * the near-black stage (D14). The fixes put both on tokens. This test holds the pairs those fixes
 * rely on, so a token edit that takes the contrast away goes red here.
 *
 * Reads the CSS as text, as theme-scope-parity.test.ts does.
 */
const THEME_CSS = readFileSync(join(__dirname, 'theme.css'), 'utf8');

function scopeBody(selector: string): string {
  const start = THEME_CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`scope ${selector} not found in theme.css`);
  return THEME_CSS.slice(start, THEME_CSS.indexOf('\n}', start));
}

type Rgb = [number, number, number];

/** A token's value in a scope, or the @theme default when the scope does not set it. */
function token(name: string, scope?: string): Rgb {
  const read = (body: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`).exec(body)?.[1];
  const hex = (scope ? read(scopeBody(scope)) : undefined) ?? read(scopeBody('@theme'));
  if (!hex) throw new Error(`--color-${name} has no 6-digit hex value in theme.css`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** `ink` at `alpha` over `surface`, as the browser paints `text-x/60`. */
function over(ink: Rgb, alpha: number, surface: Rgb): Rgb {
  return ink.map((v, i) => Math.round(v * alpha + (surface[i] as number) * (1 - alpha))) as Rgb;
}

/** WCAG 2 contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = (c: Rgb) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. */
const AA = 4.5;

describe('the ghost button label, on every surface it sits on', () => {
  const DARK = "[data-theme='dark']";

  it.each([
    ['a light card', undefined, 'surface'],
    ['a light page', undefined, 'background'],
    ['a dark card', DARK, 'surface'],
    ['a dark page', DARK, 'background'],
  ])('reads on %s', (_name, scope, surface) => {
    expect(contrast(token('foreground', scope), token(surface, scope))).toBeGreaterThanOrEqual(AA);
  });

  it('is not the ink it was: white on a light card is no contrast at all', () => {
    expect(contrast([255, 255, 255], token('surface'))).toBeLessThan(1.1);
  });
});

describe('text on the stage', () => {
  const stage = token('stage');
  const ink = token('stage-foreground');

  it('reads in the stage ink', () => {
    expect(contrast(ink, stage)).toBeGreaterThanOrEqual(AA);
  });

  it('reads in the quiet step of the stage ink the display wall uses, 60%', () => {
    expect(contrast(over(ink, 0.6, stage), stage)).toBeGreaterThanOrEqual(AA);
  });

  it('does not read in the page ink: the stage sets no scope, so that ink stays dark', () => {
    expect(contrast(token('foreground'), stage)).toBeLessThan(1.5);
  });
});
