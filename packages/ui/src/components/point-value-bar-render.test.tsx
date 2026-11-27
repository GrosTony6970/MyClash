import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PointValueBar } from './PointValueBar';

/**
 * The target-zone bar paints each point value in a chart series colour, so 1 pt and 2 pt read as
 * two segments. The status colours it used before (warning, danger) are both orange-red, and an
 * organiser could not tell the two segments apart. The organiser and public stats both draw this
 * one bar, so a change here reaches both.
 */

const t = (key: string, values?: Record<string, unknown>) =>
  `${key}(${String(values?.points ?? '')})`;

const distribution = [
  { value: 1, cleanHits: 60 },
  { value: 2, cleanHits: 30 },
  { value: 3, cleanHits: 10 },
];

describe('PointValueBar rendering', () => {
  const html = renderToStaticMarkup(<PointValueBar distribution={distribution} t={t} />);

  it('gives each point value its own chart series colour, on the bar and in the legend', () => {
    for (const n of [1, 2, 3]) {
      expect(html.match(new RegExp(`bg-chart-${n}\\b`, 'g'))).toHaveLength(2);
    }
  });

  it('uses no status colour', () => {
    expect(html).not.toMatch(/bg-(warning|danger|accent|success|info)\b/);
  });

  it('sizes each segment by its share of clean hits', () => {
    const widths = [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths).toEqual([60, 30, 10]);
  });

  it('labels each segment through the shared key, with its rounded share', () => {
    expect(html).toContain('common.pointDistribution.segment(1) 60%');
    expect(html).toContain('common.pointDistribution.segment(3) 10%');
  });

  it('draws empty segments, not NaN widths, when there are no clean hits', () => {
    const empty = renderToStaticMarkup(
      <PointValueBar distribution={[{ value: 1, cleanHits: 0 }]} t={t} />,
    );
    expect(empty).toContain('width:0%');
    expect(empty).not.toContain('NaN');
  });
});
