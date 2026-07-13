import * as React from 'react';

export interface RatingHistoryPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  rating: number;
  rank?: number | null;
}

export interface RatingHistoryChartProps {
  points: RatingHistoryPoint[];
  className?: string;
  ariaLabel?: string;
}

const W = 600;
const H = 200;
const PAD = { top: 12, right: 14, bottom: 24, left: 42 };

/**
 * A dependency-free, theme-aware SVG line chart for a fighter's rating over
 * time. Stroke inherits the accent token (via currentColor); grid + labels use
 * the muted/border tokens. Pure/presentational — hover detail is native
 * `<title>` tooltips per point.
 */
export const RatingHistoryChart = ({
  points,
  className = '',
  ariaLabel,
}: RatingHistoryChartProps) => {
  if (points.length === 0) return null;

  const ratings = points.map((p) => p.rating);
  let min = Math.min(...ratings);
  let max = Math.max(...ratings);
  if (min === max) {
    // Flat series — give the line vertical breathing room so it renders mid-box.
    min -= 1;
    max += 1;
  }
  const span = max - min;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i: number) => (n === 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW);
  const y = (r: number) => PAD.top + innerH - ((r - min) / span) * innerH;

  const polyline = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const first = points[0]!;
  const last = points[n - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      className={['h-auto w-full text-accent', className].join(' ')}
    >
      {/* min/max gridlines */}
      <line
        x1={PAD.left}
        y1={y(max)}
        x2={W - PAD.right}
        y2={y(max)}
        className="text-border"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <line
        x1={PAD.left}
        y1={y(min)}
        x2={W - PAD.right}
        y2={y(min)}
        className="text-border"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={PAD.left - 6}
        y={y(max)}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-current text-muted"
        fontSize={11}
      >
        {Math.round(max)}
      </text>
      <text
        x={PAD.left - 6}
        y={y(min)}
        textAnchor="end"
        dominantBaseline="middle"
        className="fill-current text-muted"
        fontSize={11}
      >
        {Math.round(min)}
      </text>

      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((p, i) => (
        <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.rating)} r={2.5} fill="currentColor">
          <title>{`${p.date}: ${Math.round(p.rating)}${p.rank ? ` (#${p.rank})` : ''}`}</title>
        </circle>
      ))}

      <text x={x(0)} y={H - 6} textAnchor="start" className="fill-current text-muted" fontSize={11}>
        {first.date}
      </text>
      {n > 1 && (
        <text
          x={x(n - 1)}
          y={H - 6}
          textAnchor="end"
          className="fill-current text-muted"
          fontSize={11}
        >
          {last.date}
        </text>
      )}
    </svg>
  );
};
