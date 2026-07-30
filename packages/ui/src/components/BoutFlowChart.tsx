'use client';

/**
 * BoutFlowChart — the cumulative score of a bout, drawn as a step chart.
 *
 * Rendered on the three surfaces that review a match rather than score it: the
 * pad's end-of-match overlay, the TV/projector scoreboard and the public match
 * page. Never on the live pad — that column is 360px of 44px touch targets.
 *
 * COLOURS ARE THE ORGANISER'S. Every stroke, band and dot resolves through
 * `sideColorsFor` → `sideStyle`, so a tournament run white-vs-black draws a
 * white line and a black line. There is deliberately no red/blue fallback here:
 * `'red'` and `'blue'` are the SIDE IDENTIFIERS in the data, not a palette.
 * `packages/ui` is not linted for raw palette colours, so `sideColorsFor` (and
 * its tests) is what keeps a hardcoded hex out.
 *
 * A step, not a line: score changes AT an event, so a diagonal between two
 * points would claim points were scored in between.
 *
 * Interaction is opt-in: a surface that passes `onHighlightChange` gets scrub +
 * keyboard; one that does not (the projector, which has no pointer) renders
 * inert with no handlers attached.
 *
 * The pieces live next door: `bout-flow-geometry` (scales + per-surface
 * sizing), `bout-flow-marks` (everything inside the viewBox),
 * `use-bout-flow-scrub` (pointer/keyboard) and `bout-flow-caption` (the text).
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { TournamentScoringConfig } from '@myclash/types';
import type { BoutFlowSeries } from '../utils/bout-flow';
import { formatMatchClock } from '../utils/format-match-clock';
import { sideColorsFor } from '../utils/side-color';
import { BOUT_FLOW_STYLES, CHART_W, boutFlowGeometry } from './bout-flow-geometry';
import type { BoutFlowScale } from './bout-flow-geometry';
import { Axes, Crosshair, EventMarkers, LeadBands, StepLine } from './bout-flow-marks';
import { describeBoutFlow, describeBoutFlowPoint } from './bout-flow-caption';
import { useBoutFlowScrub } from './use-bout-flow-scrub';

export type { BoutFlowScale } from './bout-flow-geometry';

export interface BoutFlowChartProps {
  series: BoutFlowSeries;
  /** The tournament's scoring config — the source of both side colours. */
  config: TournamentScoringConfig | null | undefined;
  redName: string;
  blueName: string;
  /** Which surface this paints on, so side colours stay legible against it. */
  surface?: 'dark' | 'light';
  scale?: BoutFlowScale;
  /** Shared timeline number currently highlighted, or null. */
  highlightNumber?: number | null;
  /** Provide to enable scrub + keyboard. Omit for a static render. */
  onHighlightChange?: (n: number | null) => void;
  /** App-local translator — packages/ui has no i18n context of its own. */
  t: (key: string, params?: Record<string, string>) => string;
  className?: string;
}

export function BoutFlowChart({
  series,
  config,
  redName,
  blueName,
  surface = 'dark',
  scale = 'compact',
  highlightNumber = null,
  onHighlightChange,
  t,
  className,
}: BoutFlowChartProps): React.ReactElement | null {
  const styles = BOUT_FLOW_STYLES[scale];
  const colors = useMemo(() => sideColorsFor(config, surface), [config, surface]);
  const geo = useMemo(() => boutFlowGeometry(series, styles, formatMatchClock), [series, styles]);

  const { points } = series;
  const activeIndex = points.findIndex((p) => p.number === highlightNumber);
  const active = activeIndex >= 0 ? points[activeIndex] : undefined;
  const last = points[points.length - 1];
  const { svgRef, handlers } = useBoutFlowScrub(points, geo, activeIndex, onHighlightChange);

  // Only the origin: nothing has happened yet, so there is no story to tell.
  if (points.length < 2 || !last) return null;
  const shown = active ?? last;

  return (
    <div className={`w-full ${styles.panel} ${className ?? ''}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className={styles.title}>{t('scoring.boutFlow.title')}</p>
        {/* The score at the scrubbed point, in each fighter's own colour. */}
        <p className={styles.score}>
          <span style={{ color: colors.red }}>{shown.red}</span>
          <span className={styles.label}> : </span>
          <span style={{ color: colors.blue }}>{shown.blue}</span>
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${geo.height}`}
        role="img"
        aria-label={t('scoring.boutFlow.ariaLabel', { redName, blueName })}
        className="h-auto w-full touch-none"
        {...handlers}
      >
        <Axes series={series} geo={geo} styles={styles} t={t} />
        <LeadBands points={points} geo={geo} colors={colors} />
        <EventMarkers series={series} geo={geo} surface={surface} styles={styles} />
        <StepLine points={points} geo={geo} colors={colors} width={styles.stroke} side="red" />
        <StepLine points={points} geo={geo} colors={colors} width={styles.stroke} side="blue" />
        {active && (
          <Crosshair point={active} index={activeIndex} geo={geo} colors={colors} styles={styles} />
        )}
      </svg>

      <p className={`mt-1 ${styles.summary}`} aria-live="polite">
        {active
          ? describeBoutFlowPoint(active, redName, blueName, t)
          : describeBoutFlow(series, redName, blueName, t)}
      </p>
    </div>
  );
}
