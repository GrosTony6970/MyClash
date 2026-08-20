import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

/**
 * DESIGN.md has said "`EmptyState` — every zero-state. Carries the FoilMark"
 * since the component was written, and for a year it carried no FoilMark. The
 * contract and the code disagreed and nothing could tell: no gate reads a prose
 * claim about a component, so the only thing that can hold this is a test.
 *
 * Placement is asserted too, not just presence. Above the title is a decision:
 * `title` is the only required prop, so a flourish under it dangles on the many
 * call sites that pass a title alone (`<EmptyState title={t('…')} />`). Without
 * an assertion nothing records that, and the obvious "tidy-up" is to move it
 * back under the heading.
 */
describe('EmptyState rendering', () => {
  it('carries the FoilMark its contract promises, above the title', () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);

    expect(html).toContain('<svg');
    // Decorative: the title beside it already says what the state is.
    expect(html).toContain('aria-hidden="true"');
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('<h3'));
  });

  it('spends a token on the hairline, never the raw palette class', () => {
    // FoilMark's default className is `text-slate-300` — a value no token
    // carries (known-deviations D5). Rendering the default here would add 18
    // sites to an open deviation.
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);

    expect(html).toContain('text-muted');
    expect(html).not.toContain('text-slate-300');
  });

  it('renders the FoilMark even when only a title is given', () => {
    // The zero-description case is the common one, and the reason the mark sits
    // above the title rather than below it.
    const bare = renderToStaticMarkup(<EmptyState title="Nothing here" />);
    const full = renderToStaticMarkup(
      <EmptyState title="Nothing here" description="Try another search." />,
    );

    expect(bare).toContain('<svg');
    expect(full).toContain('<svg');
  });
});
