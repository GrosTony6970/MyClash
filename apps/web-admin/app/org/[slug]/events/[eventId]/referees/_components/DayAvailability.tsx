'use client';

/**
 * The roster's "Available on" cell: a referee's ticked days, each with an optional from–to on
 * the Event's clock (ADR-019, rulings 145-147). Ticks are chips (`AvailabilityChips`); a ticked
 * day shows two time boxes, and a day the Event no longer holds is greyed.
 *
 * Every change hands `onSave` the referee's whole list of ticked days, the shape the API's
 * availability write replaces.
 */

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { localeToBcp47 } from '@myclash/time';
import { Time24Input } from '@/components/Time24Input';
import { AvailabilityChips } from './AvailabilityChips';
import { WHOLE_DAY, windowOfText, windowText, type DayTick, type DayWindow } from './day-window';

interface Props {
  days: DayTick[];
  /** Every date of the Event, first to last (`YYYY-MM-DD`). */
  eventDates: string[];
  disabled: boolean;
  onSave: (days: DayTick[]) => void;
}

const BOX =
  'w-14 rounded border border-border bg-surface px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50';

function DayWindowBoxes({
  label: dayLabel,
  window,
  disabled,
  onSave,
}: {
  label: string;
  window: DayWindow;
  disabled: boolean;
  onSave: (window: DayWindow) => void;
}) {
  const { t } = useI18n();
  const saved = windowText(window);
  const [text, setText] = useState(saved);
  // A reload after a save moves the stored window: follow it (adjust state during render).
  const [prev, setPrev] = useState(saved);
  if (saved.from !== prev.from || saved.until !== prev.until) {
    setPrev(saved);
    setText(saved);
  }
  const change = (next: typeof text) => {
    setText(next);
    const read = windowOfText(next.from, next.until);
    if (read && (read.fromMinute !== window.fromMinute || read.toMinute !== window.toMinute)) {
      onSave(read);
    }
  };
  const box = (key: 'from' | 'until', label: string) => (
    <Time24Input
      value={text[key]}
      disabled={disabled}
      onChange={(value) => change({ ...text, [key]: value })}
      className={BOX}
      aria-label={`${dayLabel} — ${label}`}
    />
  );

  return (
    <span className="inline-flex items-center gap-0.5">
      {box('from', t('organizer.refereesPage.availableFrom'))}
      <span className="text-xs text-muted">–</span>
      {box('until', t('organizer.refereesPage.availableUntil'))}
      {windowOfText(text.from, text.until) === null && (
        <span role="alert" className="text-[10px] text-danger">
          {t('organizer.refereesPage.availabilityWindowInvalid')}
        </span>
      )}
    </span>
  );
}

export function DayAvailability({ days, eventDates, disabled, onSave }: Props) {
  const { locale, t } = useI18n();
  // A calendar date, not an instant: read at UTC so no browser zone shifts it a day.
  const labelOf = (date: string) =>
    new Date(`${date}T00:00:00.000Z`).toLocaleDateString(localeToBcp47(locale), {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  const windowOf = (date: string): DayTick =>
    days.find((d) => d.date === date) ?? { date, ...WHOLE_DAY };

  return (
    <AvailabilityChips
      options={eventDates.map((date) => ({ value: date, label: labelOf(date) }))}
      selected={days.map((d) => d.date)}
      stale={days
        .filter((d) => !eventDates.includes(d.date))
        .map((d) => ({ value: d.date, label: labelOf(d.date) }))}
      staleTitle={t('organizer.refereesPage.availabilityOutsideEvent')}
      disabled={disabled}
      allLabel={t('organizer.refereesPage.availableAllDaysShort')}
      onChange={(dates) => onSave(dates.map(windowOf))}
      detail={(date, ticked) => (
        <DayWindowBoxes
          label={labelOf(date)}
          window={windowOf(date)}
          disabled={disabled}
          onSave={(window) =>
            onSave(ticked.map((d) => (d === date ? { date, ...window } : windowOf(d))))
          }
        />
      )}
    />
  );
}
