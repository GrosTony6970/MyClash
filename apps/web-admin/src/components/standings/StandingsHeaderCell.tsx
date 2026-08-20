'use client';

import * as React from 'react';
import { SortableHeader } from '@myclash/ui';

export interface StandingsHeaderCellProps {
  label: string;
  /** Canonical column key used for sort state + help lookup. */
  columnKey: string;
  /** Natural sort direction (from the ruleset column); drives first-click direction. */
  sortDesc?: boolean;
  currentKey: string | null;
  direction: 'asc' | 'desc' | null;
  onToggle: (columnKey: string, sortDesc?: boolean) => void;
  /** Resolved (already-translated) tooltip text, or null for no tooltip. */
  help?: string | null;
  align?: 'left' | 'center' | 'right';
  /** Extra classes forwarded to the sort button (e.g. accent colour for the score column). */
  className?: string;
  /** Accessible sort labels (i18n). Required — forwarded straight to
   *  `SortableHeader`, which refuses an untranslated default. */
  ariaSortAsc: string;
  ariaSortDesc: string;
  /**
   * Horizontal anchor for the tooltip bubble. Use 'start' for the leftmost
   * header and 'end' for the rightmost so the bubble stays inside a
   * horizontally-scrolling / clipped table container. Defaults to 'center'.
   */
  tooltipAnchor?: 'start' | 'center' | 'end';
}

const ANCHOR_CLASS: Record<'start' | 'center' | 'end', string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

/**
 * A standings-table column header that is both sortable (reusing the shared
 * `SortableHeader`) and, when `help` is set, reveals a tooltip on hover/focus.
 *
 * The tooltip opens **downward** (`top-full`) — the standings tables live in
 * `overflow-x-auto` / `overflow-hidden` containers, so an upward bubble would
 * be clipped. It is tokenised (`bg-strong` / `text-strong-foreground`) so it
 * adapts to light/dark, and the wrapping `group` also drives `SortableHeader`'s
 * hover chevron.
 */
export function StandingsHeaderCell({
  label,
  columnKey,
  sortDesc,
  currentKey,
  direction,
  onToggle,
  help,
  align = 'center',
  className,
  ariaSortAsc,
  ariaSortDesc,
  tooltipAnchor = 'center',
}: StandingsHeaderCellProps) {
  return (
    <span className="group relative flex w-full flex-col">
      <SortableHeader
        label={label}
        columnKey={columnKey}
        currentKey={currentKey}
        direction={direction}
        onToggle={(k) => onToggle(k, sortDesc)}
        align={align}
        className={className}
        ariaSortAsc={ariaSortAsc}
        ariaSortDesc={ariaSortDesc}
      />
      {help ? (
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full z-20 mt-2 hidden w-64 rounded-md bg-strong px-3 py-2 text-left text-xs font-medium normal-case leading-5 tracking-normal text-strong-foreground shadow-lg group-hover:block group-focus-within:block ${ANCHOR_CLASS[tooltipAnchor]}`}
        >
          {help}
        </span>
      ) : null}
    </span>
  );
}
