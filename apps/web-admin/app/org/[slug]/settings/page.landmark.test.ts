import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The organisation members page opens its own `<main>` landmark, as the other
 * workspace pages do: the shell's `#main-content` is a plain `<div>` that pads
 * nothing and names no landmark (src/components/admin-page-gutters.test.ts
 * explains the split, and scans app/admin only). This page rendered a bare
 * `<div>`, so a screen reader's landmark list had no main region here, and a
 * test reading `main` waited for one forever (2026-11-19).
 */
describe('the organisation members page', () => {
  it('renders inside its own <main>', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    const body = source.slice(source.lastIndexOf('  return ('));

    expect(body).toMatch(/^ {2}return \(\n {4}<main className="mx-auto/u);
    expect(body).toMatch(/<\/main>\n {2}\);\n\}\n?$/u);
  });
});
