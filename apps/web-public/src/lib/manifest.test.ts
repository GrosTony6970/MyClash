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
};

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
});
