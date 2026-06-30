'use client';

import type { ReactNode } from 'react';

/** Label (+ optional description) on the left, a control on the right. Shared by
 *  the notification-preferences and privacy settings sections so boolean and
 *  stepper rows line up consistently. */
export function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p> : null}
      </div>
      <div className="flex-shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

/** Lead-time presets the steppers snap to (minutes). 0 == "immediate". */
const LEAD_STEPS = [0, 5, 10, 15, 30, 60] as const;

function nearestStepIndex(value: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  LEAD_STEPS.forEach((step, i) => {
    const dist = Math.abs(step - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** −/+ stepper that snaps an arbitrary minute value to {@link LEAD_STEPS}. */
export function Stepper({
  value,
  onChange,
  disabled = false,
  formatValue,
  ariaLabel,
  decLabel,
  incLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  formatValue: (v: number) => string;
  ariaLabel: string;
  decLabel: string;
  incLabel: string;
}) {
  const idx = nearestStepIndex(value);
  const atMin = idx === 0;
  const atMax = idx === LEAD_STEPS.length - 1;
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(LEAD_STEPS[Math.max(0, idx - 1)]!)}
        disabled={disabled || atMin}
        aria-label={decLabel}
      >
        <span aria-hidden>−</span>
      </button>
      <span className="min-w-[6rem] text-center text-sm font-semibold tabular-nums text-foreground">
        {formatValue(value)}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(LEAD_STEPS[Math.min(LEAD_STEPS.length - 1, idx + 1)]!)}
        disabled={disabled || atMax}
        aria-label={incLabel}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}
