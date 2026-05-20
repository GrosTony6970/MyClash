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
  /** Number of currently selected rows. The bar is hidden when 0. */
  count: number;
  /** Optional label for the unit. Defaults to "item" / "items". */
  itemLabel?: { singular: string; plural: string };
  /** Action buttons on the right. */
  children: React.ReactNode;
  /** Optional clear-selection callback. Renders a "Clear" link if provided. */
  onClear?: () => void;
}

export function BulkActionBar({
  count,
  itemLabel = { singular: 'item', plural: 'items' },
  children,
  onClear,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const noun = count === 1 ? itemLabel.singular : itemLabel.plural;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="bulk-bar-enter fixed inset-x-4 bottom-4 z-40 mx-auto flex w-[min(960px,calc(100%-2rem))] items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">
          {count}
        </span>
        <p className="text-sm font-medium text-slate-700">
          {count} {noun} selected
        </p>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
