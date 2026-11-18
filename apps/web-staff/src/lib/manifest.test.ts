import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The manifest Android installs the pad from. Chrome refused to install it
 * while its only icon was 120 px ("no-acceptable-icon", minimum 144): so each
 * icon is held to its file, read from the PNG's own header.
 */
const publicDir = join(__dirname, '../../public');

interface Icon {
  src: string;
  sizes: string;
  purpose?: string;
}
const manifest = JSON.parse(readFileSync(join(publicDir, 'manifest.json'), 'utf8')) as {
  icons: Icon[];
  orientation?: string;
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  description?: string;
};

/** A token's value in one block of the shared theme: `@theme` (light) or `[data-theme='dark']`. */
function themeToken(block: string, name: string): string | undefined {
  const css = readFileSync(join(__dirname, '../../../../packages/ui/src/theme.css'), 'utf8');
  const start = css.indexOf(`${block} {`);
  if (start === -1) throw new Error(`theme.css has no ${block} block`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1];
}

/** Width x height from the PNG's IHDR chunk. */
function pngSize(src: string): string {
  const bytes = readFileSync(join(publicDir, src));
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('the staff manifest', () => {
  it('names icons whose files have the size it declares', () => {
    for (const icon of manifest.icons) expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
  });

  it('has the 192 and 512 icons Chrome asks for, and one Android may crop', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('opens as an app, and follows the device whichever way it is held', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.orientation).toBeUndefined();
  });

  // A manifest is a static file: it cannot follow these when a token moves.
  it('takes its colours from the theme: the accent, and the dark page the pad opens on', () => {
    expect(manifest.theme_color).toBe(themeToken('@theme', '--color-accent'));
    expect(manifest.background_color).toBe(themeToken("[data-theme='dark']", '--color-background'));
  });

  // Nothing in it goes through i18n (hard rule 6): a sentence would be in one language only.
  it('carries no description, which could not be translated', () => {
    expect(manifest.description).toBeUndefined();
  });
});
