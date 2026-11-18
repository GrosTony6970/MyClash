import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest Android installs the public app from. Chrome found none on
 * 2026-11-18 ("no-manifest"); each icon is held to its file, read from the
 * PNG's own header, since Chrome refuses an icon under 144 px.
 */
const publicDir = join(__dirname, '../../public');

interface Icon {
  src: string;
  sizes: string;
  purpose?: string;
}
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.json'), 'utf8')) as {
  icons: Icon[];
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  description?: string;
};

/** A token's value in the light block of the shared theme (`@theme`). */
function themeToken(name: string): string | undefined {
  const css = readFileSync(join(__dirname, '../../../../packages/ui/src/theme.css'), 'utf8');
  const start = css.indexOf('@theme {');
  if (start === -1) throw new Error('theme.css has no @theme block');
  const body = css.slice(start, css.indexOf('\n}', start));
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1];
}

/** Width x height from the PNG's IHDR chunk. */
function pngSize(src: string): string {
  const bytes = readFileSync(join(publicDir, src));
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('the public manifest', () => {
  it('names icons whose files have the size it declares', () => {
    for (const icon of manifest.icons) expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
  });

  it('has the 192 and 512 icons Chrome asks for, and one Android may crop', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('opens the catalogue as an app', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  // A manifest is a static file: it cannot follow these when a token moves.
  it('takes its colours from the theme: the accent, and the light page', () => {
    expect(manifest.theme_color).toBe(themeToken('--color-accent'));
    expect(manifest.background_color).toBe(themeToken('--color-background'));
  });

  // Nothing in it goes through i18n (hard rule 6): a sentence would be in one language only.
  it('carries no description, which could not be translated', () => {
    expect(manifest.description).toBeUndefined();
  });
});
