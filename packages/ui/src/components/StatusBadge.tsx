import * as React from 'react';

/**
 * StatusBadge — light-mode status pills for the admin surface.
 *
 * Tournament Manual aesthetic — pill geometry, font-semibold, no border.
 * Status semantics are carried by variant so no consumer picks colors.
 *
 *   • active / published / approved   → green   (the platform is happy)
 *   • suspended / rejected            → red     (the platform refused)
 *   • pending / draft                 → amber   (waiting on someone)
 *   • archived / neutral              → slate   (off the surface but kept)
 *   • system                          → indigo  (code-defined, immutable)
 *   • default                         → gold    (the marked-as-default row)
 *   • custom                          → blue    (admin-authored content)
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

const variantClasses: Record<StatusBadgeVariant, string> = {
  draft: 'bg-amber-50 text-amber-800',
  published: 'bg-green-50 text-green-700',
  archived: 'bg-slate-100 text-slate-600',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-800',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
  system: 'bg-indigo-50 text-indigo-700',
  custom: 'bg-blue-50 text-blue-700',
  default: 'bg-amber-50 text-amber-700',
  neutral: 'bg-slate-100 text-slate-600',
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: StatusBadgeVariant;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  variant,
  className = '',
  children,
  ...props
}) => (
  <span
    className={[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5',
      variantClasses[variant],
      className,
    ].join(' ')}
    {...props}
  >
    {children}
  </span>
);
