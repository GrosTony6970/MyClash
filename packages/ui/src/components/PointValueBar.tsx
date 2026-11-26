import type { Translator } from '../types/translator';

export type PointValueBarProps = {
  /** Clean hits per target point value, lowest value first. */
  distribution: ReadonlyArray<{ value: number; cleanHits: number }>;
  t: Translator;
};

// Chart series tokens, lowest value first. Not the status colours: warning and
// danger are both orange-red and read as one segment.
const SEGMENT_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4'];

/**
 * The target-zone bar: one segment per point value (1 pt / 2 pt / 3 pt…), sized by
 * its share of clean hits, with a legend under it. The organiser's Event statistics
 * and the public tournament statistics both draw it; the card and heading around it
 * belong to the caller.
 */
export function PointValueBar({ distribution, t }: PointValueBarProps) {
  const total = distribution.reduce((s, d) => s + d.cleanHits, 0);
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <>
      <div className="mb-2 flex h-7 gap-0.5 overflow-hidden rounded-md">
        {distribution.map((d, i) => (
          <div
            key={d.value}
            className={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
            style={{ width: `${share(d.cleanHits)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {distribution.map((d, i) => (
          <span key={d.value} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`}
            />
            {t('common.pointDistribution.segment', { points: d.value })}{' '}
            {Math.round(share(d.cleanHits))}%
          </span>
        ))}
      </div>
    </>
  );
}
