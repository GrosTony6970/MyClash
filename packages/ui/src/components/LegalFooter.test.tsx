import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LegalFooter } from './LegalFooter';

const links = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
];

/**
 * The page footer was two lines, ~110px tall. It is now one line: the note
 * sits in the same row as the links. The sidebar copy carries no rule and no
 * centring — it sits under Log out, inside the shell's own divider.
 */
describe('LegalFooter', () => {
  it('draws the page footer as one row: the note is an item of the link list', () => {
    const html = renderToStaticMarkup(<LegalFooter links={links} note="AGPL-3.0" />);
    expect(html).toContain('<li>AGPL-3.0</li>');
    expect(html).not.toContain('<p');
    expect(html).toContain('py-2');
  });

  it('draws the sidebar copy left-aligned, with no rule, the note under the links', () => {
    const html = renderToStaticMarkup(
      <LegalFooter links={links} note="AGPL-3.0" variant="sidebar" />,
    );
    expect(html).not.toContain('border-t');
    expect(html).toContain('text-left');
    expect(html).toContain('<p class="mt-1">AGPL-3.0</p>');
    expect(html).toContain('href="/privacy"');
  });
});
