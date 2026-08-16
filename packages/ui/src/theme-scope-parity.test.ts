import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [data-theme='light'] exists to override [data-theme='dark'] in a nested
 * region (web-staff's match list and chrome sit light inside a dark body).
 * That only works if it restores EVERY token the dark scope sets — a token
 * added to dark and forgotten in light leaks a dark value into a light region,
 * and the failure is invisible until someone looks at the right screen.
 *
 * Reads the CSS as text rather than parsing it: the file is the source of
 * truth and a regex over `--color-*:` declarations is exact enough for a
 * set-comparison, with no build step or CSS parser to keep in sync.
 */
const THEME_CSS = readFileSync(join(__dirname, 'theme.css'), 'utf8');

function tokensInScope(selector: string): Set<string> {
  const start = THEME_CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`scope ${selector} not found in theme.css`);
  const end = THEME_CSS.indexOf('\n}', start);
  if (end === -1) throw new Error(`scope ${selector} is not closed`);
  const body = THEME_CSS.slice(start, end);
  // [a-z0-9-], not [a-z-]: --color-chart-1..4 are numbered, and a name class
  // that stops at letters skips them silently — the scope comparison then
  // passes over a token the light scope never restored.
  return new Set(Array.from(body.matchAll(/^\s*(--color-[a-z0-9-]+):/gm), (m) => m[1] as string));
}

describe('theme scope parity', () => {
  it('light restores every token dark overrides', () => {
    const dark = tokensInScope("[data-theme='dark']");
    const light = tokensInScope("[data-theme='light']");

    expect(dark.size).toBeGreaterThan(0);
    const missing = [...dark].filter((token) => !light.has(token)).sort();
    expect(missing).toEqual([]);
  });

  it('light does not introduce tokens dark never touches', () => {
    // Not a correctness bug, but it means the light block is drifting into a
    // second source of truth for values @theme already owns.
    const dark = tokensInScope("[data-theme='dark']");
    const light = tokensInScope("[data-theme='light']");

    const extra = [...light].filter((token) => !dark.has(token)).sort();
    expect(extra).toEqual([]);
  });

  it('every light value matches the @theme default it restores', () => {
    const themeStart = THEME_CSS.indexOf('@theme {');
    const themeEnd = THEME_CSS.indexOf('\n}', themeStart);
    const themeBody = THEME_CSS.slice(themeStart, themeEnd);
    const defaults = new Map(
      Array.from(themeBody.matchAll(/^\s*(--color-[a-z0-9-]+):\s*([^;]+);/gm), (m) => [
        m[1] as string,
        (m[2] as string).trim(),
      ]),
    );

    const lightStart = THEME_CSS.indexOf("[data-theme='light'] {");
    const lightEnd = THEME_CSS.indexOf('\n}', lightStart);
    const lightBody = THEME_CSS.slice(lightStart, lightEnd);

    const drifted: string[] = [];
    for (const [, token, value] of lightBody.matchAll(/^\s*(--color-[a-z0-9-]+):\s*([^;]+);/gm)) {
      const expected = defaults.get(token as string);
      if (expected !== undefined && expected !== (value as string).trim()) {
        drifted.push(`${token}: light=${(value as string).trim()} default=${expected}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
