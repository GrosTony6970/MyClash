import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SortableHeader } from './SortableHeader';

/**
 * `ariaSortAsc` / `ariaSortDesc` used to be optional, defaulted to the English
 * literals 'Sort ascending' / 'Sort descending'. Eight column headers on the
 * organiser's Events list passed neither, so a French organiser's screen reader
 * read those columns out in English — and nothing went red: the i18n lint reads
 * JSX literals, and this default lived in a package.
 *
 * The props are required now, so the compiler catches an omission. That covers
 * the *absent* prop. These tests cover the other half: that a supplied string is
 * actually the one announced, and that no English literal survives anywhere in
 * the component. The fixtures are French on purpose — an English default
 * reintroduced by a well-meaning tidy-up would pass an English fixture.
 */
const FR_ASC = 'Tri croissant';
const FR_DESC = 'Tri décroissant';

function markup(currentKey: string | null, direction: 'asc' | 'desc' | null) {
  return renderToStaticMarkup(
    <SortableHeader
      label="Nom"
      columnKey="name"
      currentKey={currentKey}
      direction={direction}
      onToggle={() => {}}
      ariaSortAsc={FR_ASC}
      ariaSortDesc={FR_DESC}
    />,
  );
}

describe('SortableHeader accessible name', () => {
  it('announces the caller’s string, not a built-in one', () => {
    expect(markup(null, null)).toContain(`aria-label="Nom — ${FR_ASC}"`);
  });

  it('never emits an English label of its own, in any state', () => {
    // The whole point of the required props: no code path can reach a literal.
    for (const html of [markup(null, null), markup('name', 'asc'), markup('name', 'desc')]) {
      expect(html).not.toContain('Sort ascending');
      expect(html).not.toContain('Sort descending');
    }
  });

  it('offers descending only once this column is already ascending', () => {
    // aria-label names the NEXT action, not the current state. Both halves of
    // `direction === 'asc' && active` matter, and a caller cannot see either:
    // another column sorted asc must still offer ascending here.
    expect(markup('name', 'asc')).toContain(FR_DESC);
    expect(markup('name', 'desc')).toContain(FR_ASC);
    expect(markup('year', 'asc')).toContain(FR_ASC);
  });

  it('reports aria-sort for the active column only', () => {
    expect(markup(null, null)).toContain('aria-sort="none"');
    expect(markup('name', 'asc')).toContain('aria-sort="ascending"');
    expect(markup('name', 'desc')).toContain('aria-sort="descending"');
    // Sorted, but by a different column — this header is not the sorted one.
    expect(markup('year', 'asc')).toContain('aria-sort="none"');
  });
});
