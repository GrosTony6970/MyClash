import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accentClassFor, accentInkClassFor, type ColorToken } from './utils/color-token';

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
  return fromHex(hex);
}

function fromHex(hex: string): Rgb {
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

/**
 * Three inks that sat on a surface they were not made for (known-deviations D27): the accent as
 * text on the dark sign-in panel, the page ink on the accent disc of the initials, and a faded
 * white on a thin black wash over the scoreboard's white header.
 */
describe('ink on the dark panel, the initials disc and the stage toggles', () => {
  const DARK = "[data-theme='dark']";
  const PERSONAL = "[data-accent='personal']";
  const WHITE: Rgb = [255, 255, 255];

  it('reads as the panel ink on the sign-in card, in the organiser and the personal panel', () => {
    expect(contrast(token('foreground', DARK), token('surface', DARK))).toBeGreaterThanOrEqual(AA);
  });

  it('did not read as the accent there: no scope lightens the accent', () => {
    expect(contrast(token('accent'), token('surface', DARK))).toBeLessThan(3);
    expect(contrast(token('accent', PERSONAL), token('surface', DARK))).toBeLessThan(3);
  });

  it.each([
    ['a light page', undefined],
    ['the dark sidebar', DARK],
  ])('reads as initials on the strong disc, on %s', (_name, scope) => {
    expect(
      contrast(token('strong-foreground', scope), token('strong', scope)),
    ).toBeGreaterThanOrEqual(AA);
  });

  it('did not read as the page ink on the accent disc', () => {
    expect(contrast(token('foreground'), token('accent'))).toBeLessThan(3);
    expect(contrast(token('foreground'), token('accent', PERSONAL))).toBeLessThan(3);
  });

  it('reads on a stage toggle, over the white header of the scoreboard and over the stage', () => {
    const ink = token('stage-foreground');
    const stage = token('stage');
    expect(contrast(ink, over(stage, 0.8, WHITE))).toBeGreaterThanOrEqual(AA);
    expect(contrast(ink, stage)).toBeGreaterThanOrEqual(AA);
  });

  it('did not read as 70% white on a 40% black wash over that header', () => {
    const wash = over([0, 0, 0], 0.4, WHITE);
    expect(contrast(over(WHITE, 0.7, wash), wash)).toBeLessThan(3);
  });
});

/**
 * A solid fill in a colour the organiser picked — the Standings toggle, the winner's score in the
 * bracket, the league medal discs, the run header of the schedule. Each wrote a fixed white, which
 * is 1.1:1 on a white tournament and 1.5:1 on a yellow one (known-deviations D26). The fill and
 * its ink now come from the same table in color-token.ts, and this holds the table.
 *
 * The hexes are what Chromium paints for each class from the production stylesheet (Tailwind 4,
 * measured 2026-11-17). They are not the Tailwind 3 values: green-700 is #008236 here, not #15803d.
 */
describe('ink on a solid tournament colour', () => {
  const FILL: Record<string, string> = {
    'bg-red-700': '#c10007',
    'bg-blue-700': '#1447e6',
    'bg-green-700': '#008236',
    'bg-yellow-400': '#fdc700',
    'bg-purple-700': '#8200db',
    'bg-orange-600': '#f54a00',
    'bg-slate-900': '#0f172b',
    'bg-slate-100': '#f1f5f9',
    'bg-amber-600': '#e17100',
    'bg-violet-700': '#7008e7',
    'bg-teal-700': '#00786f',
    'bg-amber-400': '#ffb900',
    'bg-slate-300': '#cad5e2',
    'bg-amber-700': '#bb4d00',
    'bg-slate-400': '#90a1b9',
  };
  const INK: Record<string, string> = { 'text-white': '#ffffff', 'text-slate-900': '#0f172b' };

  // Exhaustive by type: a new ColorToken does not compile until it is listed here.
  const TOKENS: Record<ColorToken, true> = {
    red: true,
    blue: true,
    green: true,
    yellow: true,
    purple: true,
    orange: true,
    black: true,
    white: true,
    amber: true,
    violet: true,
    teal: true,
    gold: true,
    silver: true,
    bronze: true,
    slate: true,
  };

  /** The measured colour of a class, or a failure that names the class nobody measured. */
  function measured(table: Record<string, string>, cls: string): Rgb {
    const hex = table[cls];
    if (!hex) throw new Error(`${cls} has no measured colour in this test: render it and add it`);
    return fromHex(hex);
  }

  it.each(Object.keys(TOKENS) as ColorToken[])('reads on a %s fill', (name) => {
    const fill = measured(FILL, accentClassFor(name));
    const ink = measured(INK, accentInkClassFor(name));
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(AA);
  });

  it('is not the fixed white it was: white on a white, silver, yellow or gold fill cannot be read', () => {
    for (const name of ['white', 'silver', 'yellow', 'gold'] as const) {
      expect(contrast([255, 255, 255], measured(FILL, accentClassFor(name)))).toBeLessThan(2);
    }
  });
});
