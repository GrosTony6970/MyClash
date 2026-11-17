import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The download button of the Event's photos rings in `gold-text`, as `Button` does: `gold` was
 * 2.06:1 on a light page, under the 3:1 a focus indicator needs (known-deviations D32).
 */
describe('the photo download button', () => {
  it('rings in gold-text when focused from the keyboard', () => {
    const source = readFileSync(join(__dirname, 'PhotoDownload.tsx'), 'utf8');
    expect(source).toContain('focus-visible:ring-gold-text');
    expect(source).not.toMatch(/focus-visible:ring-gold(?![\w-])/);
  });
});
