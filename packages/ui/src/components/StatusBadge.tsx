import * as React from 'react';
import {
  statusPillClass,
  type StatusPillShape,
  type StatusPillSize,
  type StatusSemantic,
  type StatusSurface,
} from '../utils/status-pill';

/**
 * StatusBadge — THE status pill chip.
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
 *
 * `size` and `shape` exist because the codebase already renders these
 * shapes by hand — they were reverse-engineered from the real chips, not
 * invented. See `statusPillClass` for what each one is and where it came
 * from. A dark-surface sibling component used to exist alongside this one
 * and was deleted unused; `surface='dark'` covers that case.
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
  /** Chip footprint (defaults to `'md'`). */
  size?: StatusPillSize;
  /** Rounded pill (default) or the squared-off "flag" used for urgency. */
  shape?: StatusPillShape;
  /** Legacy — old variant API. Mapped to a semantic internally. */
  variant?: StatusBadgeVariant;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  semantic,
  surface = 'light',
  size = 'md',
  shape = 'pill',
  variant,
  className = '',
  children,
  ...props
}) => {
  const resolved: StatusSemantic = semantic ?? (variant ? VARIANT_TO_SEMANTIC[variant] : 'pending');
  return (
    <span
      className={[
        'inline-flex items-center',
        statusPillClass(resolved, surface, { size, shape }),
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
