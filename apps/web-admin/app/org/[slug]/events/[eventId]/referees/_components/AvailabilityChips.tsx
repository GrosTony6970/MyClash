'use client';

/**
 * A referee's availability on one axis — Tournaments or days — as toggle chips (ADR-019).
 *
 * The ticks are the declaration (ruling 145): no tick = available for everything on the axis,
 * including an option added later, shown as one "✓ All" pill. Clicking the pill opens every chip
 * ticked without saving; unticking one then saves the rest. Ticking every chip saves them all,
 * which the API stores as no tick again. The last tick cannot be unticked (ruling 151): "no tick"
 * would mean everything, the opposite of what the organiser meant; they take the referee off the
 * roster instead.
 *
 * `stale` are ticks the options no longer hold — a date the Event moved away from (ruling 147):
 * shown greyed, never sent back, since the API refuses a date outside the Event (ruling 149).
 * `detail` renders beside each ticked chip (a day's from–to), given every ticked value.
 */

import { useState, type ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

interface Option<TValue extends string> {
  value: TValue;
  label: string;
}

interface Props<TValue extends string> {
  options: Option<TValue>[];
  selected: TValue[];
  stale?: Option<TValue>[];
  staleTitle?: string;
  disabled?: boolean;
  allLabel: string;
  onChange: (next: TValue[]) => void;
  detail?: (value: TValue, ticked: TValue[]) => ReactNode;
}

/** A tick the options no longer hold: greyed, with its words for a screen reader too. */
function StaleChip({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted line-through opacity-60"
    >
      {label}
      {title && <span className="sr-only"> — {title}</span>}
    </span>
  );
}

/** One option. `lastTitle` set = the last tick: it says why and does nothing. */
function Chip({
  label,
  on,
  lastTitle,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  lastTitle: string | null;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={lastTitle !== null || undefined}
      title={lastTitle ?? undefined}
      onClick={lastTitle === null ? onClick : undefined}
      className={[
        'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
        on
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border bg-surface text-muted hover:border-border',
        lastTitle === null ? '' : 'cursor-not-allowed',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function AvailabilityChips<TValue extends string>({
  options,
  selected,
  stale = [],
  staleTitle,
  disabled,
  allLabel,
  onChange,
  detail,
}: Props<TValue>) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);

  if (options.length === 0) {
    return <span className="text-xs italic text-muted">—</span>;
  }
  const everything = selected.length === 0;
  if (everything && !opened) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpened(true)}
        title={allLabel}
        className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-success disabled:opacity-50"
      >
        ✓ {allLabel}
      </button>
    );
  }

  const ticked = everything
    ? options.map((o) => o.value)
    : selected.filter((v) => options.some((o) => o.value === v));
  const tickedSet = new Set(ticked);

  function save(next: TValue[]) {
    setOpened(false);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {options.map((o) => {
        const on = tickedSet.has(o.value);
        return (
          <span key={o.value} className="inline-flex items-center gap-1">
            <Chip
              label={o.label}
              on={on}
              // The last tick stays (ruling 151): unticking it would mean "everything".
              lastTitle={
                on && ticked.length === 1 ? t('organizer.refereesPage.availabilityLastTick') : null
              }
              disabled={disabled}
              onClick={() => save(on ? ticked.filter((v) => v !== o.value) : [...ticked, o.value])}
            />
            {on && detail?.(o.value, ticked)}
          </span>
        );
      })}
      {stale.map((o) => (
        <StaleChip key={o.value} label={o.label} title={staleTitle} />
      ))}
      {ticked.length > 0 && ticked.length < options.length && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => save(options.map((o) => o.value))}
          className="ml-1 text-[10px] text-muted underline hover:text-foreground-secondary disabled:opacity-50"
        >
          {t('admin.orgRefBracket.availabilityAll')}
        </button>
      )}
    </div>
  );
}
