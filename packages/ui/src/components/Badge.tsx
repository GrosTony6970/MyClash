import * as React from 'react';
import { statusPillTone, type StatusSemantic, type StatusSurface } from '../utils/status-pill';

/**
 * Badge — status pill chip rendered on a DARK surface by default
 * (live match cards, TV display, scoring app). Same two ways to
 * pick the colour as `StatusBadge`:
 *
 *   1. NEW — `semantic` prop carrying one of the canonical
 *      `StatusSemantic` values, paired with `surface='dark'`
 *      (default) or `'light'`. Use this for new callers via the
 *      per-domain mappers from `utils/status-pill.ts`.
 *
 *   2. LEGACY — `variant` prop with the older `BadgeVariant`
 *      strings. Mapped to a semantic internally so existing call
 *      sites keep working and migrate to the new canonical palette
 *      without each one changing immediately.
 */
export type BadgeVariant =
  | 'active'
  | 'suspended'
  | 'pending'
  | 'draft'
  | 'running'
  | 'completed'
  | 'voided';

const VARIANT_TO_SEMANTIC: Record<BadgeVariant, StatusSemantic> = {
  active: 'ready',
  suspended: 'paused',
  pending: 'paused',
  draft: 'pending',
  running: 'live',
  completed: 'done',
  voided: 'danger',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Preferred — pick the canonical semantic intent. */
  semantic?: StatusSemantic;
  /** Surface mode (defaults to `'dark'` for this component). */
  surface?: StatusSurface;
  /** Legacy — old variant API. Mapped to a semantic internally. */
  variant?: BadgeVariant;
}

export const Badge = ({
  semantic,
  surface = 'dark',
  variant,
  className = '',
  children,
  ...props
}: BadgeProps) => {
  const resolved: StatusSemantic = semantic ?? (variant ? VARIANT_TO_SEMANTIC[variant] : 'pending');
  const tone = statusPillTone(resolved, surface);
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tone.className,
        tone.pulse ? 'animate-pulse' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </span>
  );
};
