import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The consent line sits on the dark sign-up panel. Its two links turned to the accent on hover,
 * and no scope lightens the accent: blue on the panel's card is 2.2:1, so a link dimmed under the
 * pointer (known-deviations D27). The hover now goes to the panel's own ink.
 */
describe('the links of the consent line', () => {
  const source = readFileSync(join(__dirname, 'LegalConsent.tsx'), 'utf8');

  it('go to the panel ink on hover', () => {
    expect(source).toContain('hover:text-foreground');
  });

  it('never write the accent as text', () => {
    expect(source).not.toContain('text-accent');
  });
});
