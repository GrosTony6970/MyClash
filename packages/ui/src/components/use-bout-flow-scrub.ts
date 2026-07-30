'use client';

/**
 * use-bout-flow-scrub — pointer + keyboard navigation over the flow chart.
 *
 * Returns nothing when the surface passes no `onHighlightChange`: the projector
 * has no pointer, and attaching dead handlers there would only cost work on
 * every frame of a screen nobody touches.
 *
 * Pointer events, not mouse events, so a finger dragging across the tablet's
 * end-of-bout panel scrubs exactly like a mouse. Arrow keys do the same job for
 * keyboard users, who can never reach a hover.
 */

import * as React from 'react';
import { useCallback, useRef } from 'react';
import type { BoutFlowPoint } from '../utils/bout-flow';
import { CHART_W, type BoutFlowGeometry } from './bout-flow-geometry';

export interface BoutFlowScrub {
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Spread onto the <svg>. Empty when the chart is not interactive. */
  handlers: React.SVGProps<SVGSVGElement>;
}

export function useBoutFlowScrub(
  points: BoutFlowPoint[],
  geo: BoutFlowGeometry,
  activeIndex: number,
  onHighlightChange: ((n: number | null) => void) | undefined,
): BoutFlowScrub {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const pick = useCallback(
    (clientX: number) => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      // Client pixels → viewBox units, then snap to the nearest event.
      const vx = ((clientX - box.left) / box.width) * CHART_W;
      let bestIndex = 0;
      let bestGap = Infinity;
      points.forEach((p, i) => {
        const gap = Math.abs(geo.xOf(p, i) - vx);
        if (gap < bestGap) {
          bestGap = gap;
          bestIndex = i;
        }
      });
      onHighlightChange?.(points[bestIndex]?.number ?? null);
    },
    [points, geo, onHighlightChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0 && !['Home', 'End', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Escape') return onHighlightChange?.(null);
      if (e.key === 'Home') return onHighlightChange?.(points[0]?.number ?? null);
      if (e.key === 'End') return onHighlightChange?.(points[points.length - 1]?.number ?? null);
      // Entering from outside, step in from whichever end you are heading away from.
      const from = activeIndex >= 0 ? activeIndex : step > 0 ? -1 : points.length;
      const next = Math.min(points.length - 1, Math.max(0, from + step));
      onHighlightChange?.(points[next]?.number ?? null);
    },
    [activeIndex, points, onHighlightChange],
  );

  const handlers: React.SVGProps<SVGSVGElement> = onHighlightChange
    ? {
        tabIndex: 0,
        onKeyDown,
        onPointerMove: (e) => pick(e.clientX),
        onPointerDown: (e) => pick(e.clientX),
        onPointerLeave: () => onHighlightChange(null),
      }
    : {};

  return { svgRef, handlers };
}
