import * as React from 'react';

/**
 * Header cell content with a click-to-sort affordance for `<DataTableHead>`.
 *
 * Clicking cycles `null → asc → desc → null` so the operator can return to
 * the API-returned order. The chevron is reserved-space (always laid out)
 * but only visible on the active column — that keeps column widths stable
 * across sort toggles.
 */
export interface SortableHeaderProps {
  label: string;
  columnKey: string;
  currentKey: string | null;
  direction: 'asc' | 'desc' | null;
  onToggle: (columnKey: string) => void;
  /**
   * Accessible name for the sort button — appended to `label` as aria-label,
   * so it is the sentence a screen reader reads out.
   *
   * Required, and deliberately not defaulted. packages/ui carries no
   * dictionary of its own (see src/types/translator.ts), so a default here
   * could only be an English literal — and an optional English default is a
   * branch that fires silently: a caller that forgets these props ships
   * "Sort ascending" to a French organiser and nothing goes red. Required
   * makes the compiler name every site instead.
   */
  ariaSortAsc: string;
  ariaSortDesc: string;
  className?: string;
  /**
   * Horizontal alignment for the label + chevron pair. Defaults to
   * 'left' (preserves every existing caller). Use 'center' on
   * numeric-count columns so the header reads centred above the
   * centred cell values.
   */
  align?: 'left' | 'center' | 'right';
}

export const SortableHeader: React.FC<SortableHeaderProps> = ({
  label,
  columnKey,
  currentKey,
  direction,
  onToggle,
  ariaSortAsc,
  ariaSortDesc,
  className = '',
  align = 'left',
}) => {
  const active = currentKey === columnKey && direction !== null;
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const nextLabel = direction === 'asc' && active ? ariaSortDesc : ariaSortAsc;
  const alignClasses =
    align === 'center'
      ? 'justify-center text-center'
      : align === 'right'
        ? 'justify-end text-right'
        : 'text-left';

  return (
    <button
      type="button"
      onClick={() => onToggle(columnKey)}
      aria-sort={ariaSort}
      aria-label={`${label} — ${nextLabel}`}
      className={[
        'inline-flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors',
        alignClasses,
        active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
        className,
      ].join(' ')}
    >
      <span>{label}</span>
      <SortChevron active={active} direction={direction} />
    </button>
  );
};

const SortChevron: React.FC<{ active: boolean; direction: 'asc' | 'desc' | null }> = ({
  active,
  direction,
}) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 10 14"
    width="10"
    height="14"
    className={[
      'shrink-0 transition-opacity',
      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
    ].join(' ')}
  >
    <path d={direction === 'desc' ? 'M5 13 L1 6 L9 6 Z' : 'M5 1 L9 8 L1 8 Z'} fill="currentColor" />
  </svg>
);

/**
 * Stable, locale-aware sort over an in-memory list.
 *
 * Returns the original array (reference-equal) when no sort is active so
 * consumers can rely on identity for downstream memoization.
 *
 * Rows with no value in the sorted column (null / undefined / '') sink to the
 * bottom in *both* directions — reversing them would put every "—" cell on
 * top, which is never what the operator asked for by clicking the header.
 */
export function sortRows<T>(
  rows: readonly T[],
  sortKey: string | null,
  direction: 'asc' | 'desc' | null,
  getValue: (row: T, key: string) => unknown,
): readonly T[] {
  if (!sortKey || !direction) return rows;
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const va = getValue(a.row, sortKey);
    const vb = getValue(b.row, sortKey);
    const missing = compareMissing(va, vb);
    if (missing !== null) return missing === 0 ? a.index - b.index : missing;
    const cmp = compareValues(va, vb, collator);
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.row);
}

/**
 * Direction-independent ordering for empty cells: `null` when both sides carry
 * a value (compare them normally), otherwise the missing side goes last.
 */
function compareMissing(a: unknown, b: unknown): number | null {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (!aMissing && !bMissing) return null;
  if (aMissing && bMissing) return 0;
  return aMissing ? 1 : -1;
}

function compareValues(a: unknown, b: unknown, collator: Intl.Collator): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return collator.compare(String(a), String(b));
}

/**
 * `[sortKey, direction]` cycler that pairs with `<SortableHeader>`'s
 * `onToggle`. Cycle: null → asc → desc → null.
 */
export function nextSortState(
  currentKey: string | null,
  currentDir: 'asc' | 'desc' | null,
  columnKey: string,
): { key: string | null; direction: 'asc' | 'desc' | null } {
  if (currentKey !== columnKey) return { key: columnKey, direction: 'asc' };
  if (currentDir === 'asc') return { key: columnKey, direction: 'desc' };
  return { key: null, direction: null };
}
