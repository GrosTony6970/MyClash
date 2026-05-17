'use client';

import { useMemo, useState } from 'react';

interface IsoDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  locale?: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  weekdayLabels: readonly string[];
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function buildMonthDays(month: Date): Array<Date | null> {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const firstMondayIndex = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const cells: Array<Date | null> = Array.from({ length: firstMondayIndex }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function IsoDatePicker({
  id,
  label,
  value,
  onChange,
  min,
  locale = 'en',
  previousMonthLabel,
  nextMonthLabel,
  weekdayLabels,
}: IsoDatePickerProps) {
  const selectedDate = parseIsoDate(value);
  const minDate = min ? parseIsoDate(min) : null;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const basis = selectedDate ?? minDate ?? new Date();
    return new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), 1));
  });

  const cells = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(visibleMonth);

  function openCalendar() {
    const basis = selectedDate ?? minDate;
    if (basis) setVisibleMonth(new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), 1)));
    setOpen(true);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={openCalendar}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-left text-sm text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-600"
      >
        {value || 'YYYY-MM-DD'}
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label={previousMonthLabel}
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
            >
              &lt;
            </button>
            <p className="text-sm font-semibold capitalize text-slate-900">{monthLabel}</p>
            <button
              type="button"
              aria-label={nextMonthLabel}
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
            >
              &gt;
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
            {weekdayLabels.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              const iso = day ? formatIsoDate(day) : '';
              const disabled = Boolean(day && minDate && day < minDate);
              const selected = iso === value;
              return day ? (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={[
                    'h-8 rounded-md text-sm transition-colors',
                    selected ? 'bg-red-700 text-white' : 'text-slate-700 hover:bg-slate-100',
                    disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : '',
                  ].join(' ')}
                >
                  {day.getUTCDate()}
                </button>
              ) : (
                <span key={`empty-${index}`} className="h-8" />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
