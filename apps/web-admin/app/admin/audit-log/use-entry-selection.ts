'use client';

import { useState } from 'react';

/**
 * Which log entry the side panel shows (ruling 911), for both tabs of the Log page.
 *
 * The selection is `{ id, index }` and the row shown is worked out during render, never in an
 * effect. The race it handles: while the panel is open the list reloads only after Resolve
 * (paging and filters sit under the dimmed page), and the list drops a resolved query error.
 * So the panel shows the row with that id, else the row that took its place, else nothing and
 * it closes. It never shows a row the list no longer holds.
 */
export interface EntrySelection {
  id: string;
  index: number;
}

/** The index of the row shown, or -1 when none is. */
export function shownIndex(ids: readonly string[], selection: EntrySelection | null): number {
  if (!selection || ids.length === 0) return -1;
  const at = ids.indexOf(selection.id);
  return at >= 0 ? at : Math.min(selection.index, ids.length - 1);
}

export interface EntrySelectionState<T extends { id: string } = { id: string }> {
  /** The row the panel shows; null when it is closed. */
  entry: T | null;
  index: number;
  count: number;
  open: (id: string) => void;
  close: () => void;
  /** Moves within the page; at its first or last row it does nothing. */
  step: (delta: -1 | 1) => void;
}

export function useEntrySelection<T extends { id: string }>(
  items: readonly T[],
): EntrySelectionState<T> {
  const [selection, setSelection] = useState<EntrySelection | null>(null);
  const ids = items.map((item) => item.id);
  const index = shownIndex(ids, selection);
  return {
    entry: index >= 0 ? (items[index] ?? null) : null,
    index,
    count: items.length,
    open: (id: string) => setSelection({ id, index: ids.indexOf(id) }),
    close: () => setSelection(null),
    step: (delta: -1 | 1) => {
      const next = index + delta;
      const id = ids[next];
      if (index >= 0 && id !== undefined) setSelection({ id, index: next });
    },
  };
}

/**
 * The arrow key a panel acts on: -1 up, 1 down, 0 none. Not on the scrolling body itself (there
 * the keys scroll a long record), not in a form field, not with a modifier key.
 */
export function panelArrowStep(event: {
  key: string;
  target: EventTarget | null;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): -1 | 0 | 1 {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.matches('[data-modal-body], input, select, textarea, [contenteditable]')) return 0;
  if (event.key === 'ArrowUp') return -1;
  if (event.key === 'ArrowDown') return 1;
  return 0;
}

/**
 * A click on a row opens its entry only when it happened in the row's own page, not inside a
 * dialog React carried up to it (the payload Details pop-up is portalled but mounted in the row),
 * and not on a link or a button, which do their own job.
 */
export function rowClickOpens(event: { currentTarget: Element; target: EventTarget | null }) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !event.currentTarget.contains(target)) return false;
  return !target.closest('a, button, input, select, textarea, summary');
}

/** The time button of a row, the one focus returns to when the panel closes. */
export function entryButton(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-entry-open="${id.replace(/"/g, '')}"]`);
}
