import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminPageHeader } from './AdminPageHeader';

/**
 * DESIGN.md gives the page-header eyebrow the accent (`page-header-eyebrow:
 * textColor: '{colors.accent}'`) and every hairline the border token. The header
 * read raw `text-red-800` and `border-slate-200` instead (known-deviations D5),
 * and no gate reads a component's classes against that contract — so this test
 * holds it. The FoilMark keeps `text-slate-300`: no token carries that value.
 */
describe('AdminPageHeader rendering', () => {
  const html = renderToStaticMarkup(<AdminPageHeader eyebrow="Event" title="Pools" />);
  const headerTag = html.slice(0, html.indexOf('>'));
  const eyebrowTag = html.match(/<p class="[^"]*uppercase[^"]*"/)?.[0] ?? '';

  it('finds the header and the eyebrow it checks', () => {
    expect(headerTag).toMatch(/^<header/);
    expect(eyebrowTag).not.toBe('');
  });

  it('draws the rule under the header with the border token', () => {
    expect(headerTag).toContain('border-border');
    expect(headerTag).not.toContain('border-slate-200');
  });

  it('colours the eyebrow with the accent token', () => {
    expect(eyebrowTag).toContain('text-accent');
    expect(eyebrowTag).not.toContain('text-red-800');
  });
});
