/**
 * bout-flow-geometry.ts — the scales and per-surface sizing for BoutFlowChart.
 *
 * Split out of the component so the maths is readable on its own (and so the
 * chart file stays about drawing). Pure: no React.
 */

import type { BoutFlowPoint, BoutFlowSeries } from '../utils/bout-flow';

export type BoutFlowScale = 'compact' | 'tv' | 'page';

/** viewBox width. Height varies per scale; the box is responsive either way. */
export const CHART_W = 600;
export const CHART_PAD = { top: 10, right: 12, bottom: 22, left: 34 };

export interface BoutFlowStyles {
  height: number;
  axisFont: number;
  stroke: number;
  dot: number;
  /** Chrome classes: the TV stage is a hardcoded near-black inside light apps,
   *  so it needs explicit greys where the other scales use semantic tokens. */
  grid: string;
  label: string;
  title: string;
  score: string;
  summary: string;
  panel: string;
}

export const BOUT_FLOW_STYLES: Record<BoutFlowScale, BoutFlowStyles> = {
  compact: {
    height: 200,
    axisFont: 11,
    stroke: 2,
    dot: 2.5,
    grid: 'text-border',
    label: 'text-muted',
    title: 'text-xs font-bold uppercase tracking-wide text-muted',
    score: 'font-mono text-sm font-bold tabular-nums',
    summary: 'text-[11px] text-muted',
    panel: 'rounded-lg border border-border bg-background p-2',
  },
  page: {
    height: 220,
    axisFont: 11,
    stroke: 2,
    dot: 3,
    grid: 'text-border',
    label: 'text-muted',
    title: 'text-xs font-bold uppercase tracking-wide text-muted',
    score: 'font-mono text-base font-bold tabular-nums',
    summary: 'text-xs text-muted',
    panel: 'rounded-lg border border-border bg-surface p-3 shadow-xs',
  },
  tv: {
    height: 190,
    axisFont: 14,
    stroke: 3,
    dot: 4,
    grid: 'text-gray-700',
    label: 'text-gray-400',
    title: 'text-sm font-bold uppercase tracking-widest text-gray-500',
    score: 'font-mono text-xl font-bold tabular-nums',
    summary: 'text-xs text-gray-500',
    panel: 'rounded-lg border border-gray-800 bg-gray-900/50 p-3',
  },
};

export interface BoutFlowGeometry {
  height: number;
  /** x for a point — match time when the series supports it, else its index. */
  xOf: (p: BoutFlowPoint, i: number) => number;
  /** x for a bare match-time offset (the pause markers). */
  xOfMs: (ms: number) => number;
  yOf: (v: number) => number;
  /** y of the bout's finish line: the cap, or 0 when the bout counts down. */
  capY: number;
  capLabel: number;
  ticks: { x: number; label: string }[];
}

export function boutFlowGeometry(
  series: BoutFlowSeries,
  s: BoutFlowStyles,
  timeLabel: (ms: number) => string,
): BoutFlowGeometry {
  const { points, xAxis } = series;
  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const innerH = s.height - CHART_PAD.top - CHART_PAD.bottom;
  const n = points.length;

  const maxMs = Math.max(...points.map((p) => p.elapsedMs ?? 0), 1);
  const xOfMs = (ms: number) => CHART_PAD.left + (ms / maxMs) * innerW;
  const xOf = (p: BoutFlowPoint, i: number) =>
    xAxis === 'time'
      ? xOfMs(p.elapsedMs ?? 0)
      : CHART_PAD.left + (n === 1 ? 0 : (i / (n - 1)) * innerW);

  // The cap is always on-canvas: a chart that hides the finish line cannot
  // answer the question a spectator actually has.
  const scores = points.flatMap((p) => [p.red, p.blue]);
  const top = Math.max(series.pointCap, ...scores, 1);
  const bottom = Math.min(0, ...scores);
  const span = top - bottom || 1;
  const yOf = (v: number) => CHART_PAD.top + innerH - ((v - bottom) / span) * innerH;

  const capLabel = series.reverse ? 0 : series.pointCap;
  const last = points[n - 1];
  const ticks =
    xAxis === 'time'
      ? [
          { x: xOfMs(0), label: timeLabel(0) },
          { x: xOfMs(maxMs), label: timeLabel(maxMs) },
        ]
      : [
          { x: xOf(points[0]!, 0), label: '1' },
          { x: xOf(last!, n - 1), label: String(last?.number ?? n) },
        ];

  return { height: s.height, xOf, xOfMs, yOf, capY: yOf(capLabel), capLabel, ticks };
}
