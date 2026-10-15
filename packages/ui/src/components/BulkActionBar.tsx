'use client';

import * as React from 'react';

/**
 * BulkActionBar — sticky action bar that surfaces when a list page has
 * one or more rows selected. Sits at the bottom of the viewport,
 * slides in from below.
 *
 * Tournament Manual aesthetic: slate-900 ink card with hairline border,
 * red-800 / amber accents for action affordances.
 */
export interface BulkActionBarProps {
  /** Number of currently selected rows. The bar is hidden below `minCount`. */
  count: number;
  /**
   * The bar's words, already translated (X4): the region's name, the count sentence
   * ("3 clubs selected") and the Clear button.
   */
  labels: { region: string; selected: string; clear: string };
  /** Action buttons on the right. */
  children: React.ReactNode;
  /** Optional clear-selection callback. Renders a "Clear" link if provided. */
  onClear?: () => void;
  /**
   * Where the bar appears.
   * - `bottom-floating` (default): pinned to the bottom of the viewport.
   * - `top-sticky`: sticks to the top of its scroll container; the JSX must
   *   live above the list it controls.
   */
  placement?: 'bottom-floating' | 'top-sticky';
  /** Minimum selected count for the bar to render. Defaults to 1. */
  minCount?: number;
}

export function BulkActionBar({
  count,
  labels,
  children,
  onClear,
  placement = 'bottom-floating',
  minCount = 1,
}: BulkActionBarProps) {
  if (count < minCount) return null;

  // z-sticky (20), not the bare z-30 this used to carry: 30 is the page
  // header's layer, and a tie meant the pinned bar painted over the shell
  // header instead of sliding under it.
  const layoutClass =
    placement === 'top-sticky'
      ? 'sticky top-2 z-sticky flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-md mb-4'
      : 'bulk-bar-enter fixed inset-x-4 bottom-4 z-sidebar mx-auto flex w-[min(960px,calc(100%-2rem))] items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-lg';

  return (
    <div role="region" aria-label={labels.region} className={layoutClass}>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">
          {count}
        </span>
        <p className="text-sm font-medium text-slate-700">{labels.selected}</p>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
          >
            {labels.clear}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
