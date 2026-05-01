import * as React from 'react';

export type BadgeVariant =
  | 'active'
  | 'suspended'
  | 'pending'
  | 'draft'
  | 'running'
  | 'completed'
  | 'voided';

const variantMap: Record<BadgeVariant, string> = {
  active: 'bg-green-900/60 text-green-300 border-green-800',
  suspended: 'bg-red-900/60 text-red-300 border-red-800',
  pending: 'bg-yellow-900/60 text-yellow-300 border-yellow-800',
  draft: 'bg-gray-800 text-gray-400 border-gray-700',
  running: 'bg-blue-900/60 text-blue-300 border-blue-800 animate-pulse',
  completed: 'bg-gray-800 text-gray-300 border-gray-700',
  voided: 'bg-gray-900 text-gray-500 border-gray-800 line-through',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
}

export const Badge = ({ variant, className = '', children, ...props }: BadgeProps) => (
  <span
    className={[
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
      variantMap[variant],
      className,
    ].join(' ')}
    {...props}
  >
    {children}
  </span>
);
