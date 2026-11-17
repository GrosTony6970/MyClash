import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The focus ring of `Button` and of the dialog buttons is `gold-text`, not `gold`: gold was 2.06:1
 * on a light page (known-deviations D32). `theme-ink-contrast.test.ts` measures the ring in both
 * scopes.
 */
const GOLD_RING = /focus-visible:ring-gold(?![\w-])/;

describe('the keyboard focus ring', () => {
  it.each(['Button.tsx', 'dialog-classes.ts'])('%s rings in gold-text', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).toContain('focus-visible:ring-gold-text');
    expect(source).not.toMatch(GOLD_RING);
  });
});
