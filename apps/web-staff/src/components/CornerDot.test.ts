import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The corner colour sits beside the words as a dot; it never colours them (known-deviations D38).
 * The ring gives a black or white corner an edge on either theme. This app's tests do not compile
 * JSX, so the source is read as text; `corner-ink.test.ts` scans the app for the shape it replaces.
 */
describe('CornerDot', () => {
  const source = readFileSync(join(__dirname, 'CornerDot.tsx'), 'utf8');

  it('paints the corner colour as a fill, not as ink', () => {
    expect(source).toContain('style={{ backgroundColor: hex }}');
    expect(source).not.toMatch(/(?<![\w-])color:/);
  });

  it('draws an edge ring and hides itself from screen readers', () => {
    expect(source).toContain('ring-1 ring-inset ring-foreground/50');
    expect(source).toContain('aria-hidden="true"');
  });
});
