import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rankBadge } from './StandingsGroups';

/**
 * The medal discs of a league's standings are solid gold, silver and bronze. They wrote a white
 * digit on all three: 1.7:1 on gold and 1.5:1 on silver, so the rank of the first two could not be
 * read (known-deviations D26). The fill now brings its ink from `accentInkClassFor`;
 * `packages/ui/src/theme-ink-contrast.test.ts` measures each pair.
 */
describe('the rank disc', () => {
  it.each([
    [1, 'bg-amber-400', 'text-slate-900'],
    [2, 'bg-slate-300', 'text-slate-900'],
    [3, 'bg-amber-700', 'text-white'],
  ])('rank %i is %s with %s', (rank, fill, ink) => {
    const classes = /class="([^"]*)"/.exec(renderToStaticMarkup(rankBadge(rank)))?.[1]?.split(' ');
    expect(classes).toContain(fill);
    expect(classes?.filter((c) => c.startsWith('text-') && c !== 'text-xs')).toEqual([ink]);
  });
});

describe('the league page sources', () => {
  // The champion disc and the "Season finalized" pill are gold fills inside components that need
  // the league's data to render, so they are read as text.
  it.each(['StandingsGroups.tsx', 'page.tsx'])('%s writes no fixed white', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).not.toContain('text-white');
  });

  it.each(['StandingsGroups.tsx', 'page.tsx'])('%s takes the ink of every gold fill', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    const fills = source.match(/accentClassFor\('gold'\)/g) ?? [];
    const inks = source.match(/accentInkClassFor\('gold'\)/g) ?? [];
    expect(fills.length).toBeGreaterThan(0);
    expect(inks).toHaveLength(fills.length);
  });
});
