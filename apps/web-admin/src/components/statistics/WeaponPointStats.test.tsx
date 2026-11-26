import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeaponPointStatsSection } from './WeaponPointStats';
import type { WeaponTargetStats } from './types';

/**
 * The target-zone bar paints each point value in a chart series colour, so 1 pt and 2 pt read as
 * two segments. The status colours it used before (warning, danger) are both orange-red, and an
 * organiser could not tell the two segments apart.
 */

const t = (key: string) => key;

const weapon: WeaponTargetStats = {
  weapon: 'Longsword',
  maxValue: 3,
  distribution: [
    { value: 1, cleanHits: 60 },
    { value: 2, cleanHits: 30 },
    { value: 3, cleanHits: 10 },
  ],
  hunters: [],
};

describe('WeaponPointStatsSection — target-zone bar colours', () => {
  const html = renderToStaticMarkup(<WeaponPointStatsSection breakdown={[weapon]} t={t} />);

  it('gives each point value its own chart series colour, on the bar and in the legend', () => {
    for (const n of [1, 2, 3]) {
      expect(html.match(new RegExp(`bg-chart-${n}\\b`, 'g'))).toHaveLength(2);
    }
  });

  it('uses no status colour', () => {
    expect(html).not.toMatch(/bg-(warning|danger|accent|success|info)\b/);
  });
});
