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
};

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
});
