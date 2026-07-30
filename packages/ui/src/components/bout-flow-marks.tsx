'use client';

/**
 * bout-flow-marks.tsx — every mark BoutFlowChart draws inside its viewBox.
 *
 * Split from the chart so that file stays a composition and these stay pure
 * geometry-to-SVG. All colour arrives as resolved hex from `sideColorsFor`;
 * nothing here decides a colour, which is what keeps a red/blue constant out.
 */

import * as React from 'react';
import type { BoutFlowPoint, BoutFlowSeries } from '../utils/bout-flow';
import { legibleOn, styleForToken } from '../utils/side-color';
import {
  CHART_PAD,
  CHART_W,
  type BoutFlowGeometry,
  type BoutFlowStyles,
} from './bout-flow-geometry';

export type SideColors = { red: string; blue: string };

/** Lead band: one rectangle per step, tinted by whoever led across it. */
export function LeadBands({
  points,
  geo,
  colors,
}: {
  points: BoutFlowPoint[];
  geo: BoutFlowGeometry;
  colors: SideColors;
}) {
  return (
    <g>
      {points.slice(0, -1).map((p, i) => {
        if (p.red === p.blue) return null;
        const x1 = geo.xOf(p, i);
        const x2 = geo.xOf(points[i + 1]!, i + 1);
        const yHigh = geo.yOf(Math.max(p.red, p.blue));
        const yLow = geo.yOf(Math.min(p.red, p.blue));
        return (
          <rect
            key={p.number}
            x={x1}
            y={yHigh}
            width={Math.max(0, x2 - x1)}
            height={Math.max(0, yLow - yHigh)}
            fill={p.red > p.blue ? colors.red : colors.blue}
            opacity={0.13}
          />
        );
      })}
    </g>
  );
}

/** One fighter's running score as a step path. */
export function StepLine({
  points,
  geo,
  colors,
  width,
  side,
}: {
  points: BoutFlowPoint[];
  geo: BoutFlowGeometry;
  colors: SideColors;
  width: number;
  side: 'red' | 'blue';
}) {
  const d = points
    .map((p, i) => {
      const x = geo.xOf(p, i).toFixed(1);
      const y = geo.yOf(p[side]).toFixed(1);
      // Horizontal to this event, then the jump: the score changed AT it.
      return i === 0 ? `M ${x} ${y}` : `H ${x} V ${y}`;
    })
    .join(' ');
  return (
    <path
      d={d}
      fill="none"
      stroke={colors[side]}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/** Cards, doubles and clock stoppages — the things a flat line hides. */
export function EventMarkers({
  series,
  geo,
  surface,
  styles,
}: {
  series: BoutFlowSeries;
  geo: BoutFlowGeometry;
  surface: 'dark' | 'light';
  styles: BoutFlowStyles;
}) {
  const floor = geo.height - CHART_PAD.bottom;
  return (
    <g>
      {series.xAxis === 'time' &&
        series.pauses.map((pause) => (
          <line
            key={`pause-${pause.elapsedMs}`}
            x1={geo.xOfMs(pause.elapsedMs)}
            y1={CHART_PAD.top}
            x2={geo.xOfMs(pause.elapsedMs)}
            y2={floor}
            className={styles.grid}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
      {series.points.map((p, i) =>
        !p.card && !p.isDouble ? null : (
          <line
            key={`mark-${p.number}`}
            x1={geo.xOf(p, i)}
            y1={floor - 6}
            x2={geo.xOf(p, i)}
            y2={floor}
            className={p.card ? undefined : styles.label}
            stroke={p.card ? legibleOn(styleForToken(p.card).border, surface) : 'currentColor'}
            strokeWidth={p.card ? 3 : 2}
            strokeLinecap="round"
          />
        ),
      )}
    </g>
  );
}

/** Crosshair + dots on the scrubbed event. */
export function Crosshair({
  point,
  index,
  geo,
  colors,
  styles,
}: {
  point: BoutFlowPoint;
  index: number;
  geo: BoutFlowGeometry;
  colors: SideColors;
  styles: BoutFlowStyles;
}) {
  const x = geo.xOf(point, index);
  return (
    <g pointerEvents="none">
      <line
        x1={x}
        y1={CHART_PAD.top}
        x2={x}
        y2={geo.height - CHART_PAD.bottom}
        className={styles.label}
        stroke="currentColor"
        strokeWidth={1}
      />
      <circle cx={x} cy={geo.yOf(point.red)} r={styles.dot + 1.5} fill={colors.red} />
      <circle cx={x} cy={geo.yOf(point.blue)} r={styles.dot + 1.5} fill={colors.blue} />
    </g>
  );
}

/** The cap rule + its label, and the two axis ends. */
export function Axes({
  series,
  geo,
  styles,
  t,
}: {
  series: BoutFlowSeries;
  geo: BoutFlowGeometry;
  styles: BoutFlowStyles;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  return (
    <g>
      <line
        x1={CHART_PAD.left}
        y1={geo.capY}
        x2={CHART_W - CHART_PAD.right}
        y2={geo.capY}
        className={styles.grid}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text
        x={CHART_PAD.left - 5}
        y={geo.capY}
        textAnchor="end"
        dominantBaseline="middle"
        className={`fill-current ${styles.label}`}
        fontSize={styles.axisFont}
      >
        {geo.capLabel}
      </text>
      {geo.ticks.map((tick, i) => (
        <text
          key={`${tick.label}-${String(i)}`}
          x={tick.x}
          y={geo.height - 5}
          textAnchor={i === 0 ? 'start' : 'end'}
          className={`fill-current ${styles.label}`}
          fontSize={styles.axisFont}
        >
          {tick.label}
        </text>
      ))}
      <text
        x={(CHART_W + CHART_PAD.left) / 2}
        y={geo.height - 5}
        textAnchor="middle"
        className={`fill-current ${styles.label}`}
        fontSize={styles.axisFont}
      >
        {t(series.xAxis === 'time' ? 'scoring.boutFlow.axisTime' : 'scoring.boutFlow.axisExchange')}
      </text>
    </g>
  );
}
