import * as React from 'react';
import { statusPillTone, type StatusSemantic, type StatusSurface } from '../utils/status-pill';

/**
 * StatusBadge — status pill chip.
 *
 * Two ways to pick the colour:
 *
 *   1. NEW — `semantic` prop carrying one of the canonical
 *      `StatusSemantic` values from `utils/status-pill.ts`. Pair
 *      with `surface='light'` (admin, default) or `'dark'` (scoring
 *      app / TV display). This is the path every new caller should
 *      use; per-domain mappers (`tournamentStatusSemantic`,
 *      `matchStatusSemantic`, etc.) translate a concrete status
 *      string into the right semantic.
 *
 *   2. LEGACY — `variant` prop with one of the older
 *      `StatusBadgeVariant` strings. Kept so existing call sites
 *      don't break; internally maps each variant to a semantic +
 *      `surface='light'` and routes through the same helper, so the
 *      colours land on the new canonical palette without each call
 *      site needing to change immediately.
 */
export type StatusBadgeVariant =
  | 'draft'
  | 'published'
  | 'archived'
  | 'active'
  | 'suspended'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'system'
  | 'custom'
  | 'default'
  | 'neutral';

const VARIANT_TO_SEMANTIC: Record<StatusBadgeVariant, StatusSemantic> = {
  draft: 'pending',
  pending: 'pending',
  custom: 'pending',
  neutral: 'pending',
  published: 'ready',
  active: 'ready',
  approved: 'done',
  system: 'ready',
  default: 'ready',
  suspended: 'paused',
  rejected: 'danger',
  archived: 'archived',
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Preferred — pick the canonical semantic intent. */
  semantic?: StatusSemantic;
  /** Surface mode (defaults to `'light'`). */
  surface?: StatusSurface;
  /** Legacy — old variant API. Mapped to a semantic internally. */
  variant?: StatusBadgeVariant;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  semantic,
  surface = 'light',
  variant,
  className = '',
  children,
  ...props
}) => {
  const resolved: StatusSemantic = semantic ?? (variant ? VARIANT_TO_SEMANTIC[variant] : 'pending');
  const tone = statusPillTone(resolved, surface);
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5',
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
