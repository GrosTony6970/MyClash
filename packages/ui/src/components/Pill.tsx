import * as React from 'react';

export type PillVariant = 'default' | 'red' | 'blue' | 'gold' | 'green' | 'orange' | 'gray';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  size?: 'sm' | 'md';
}

const variantClasses: Record<PillVariant, string> = {
  default: 'bg-gray-800 text-gray-300 border-gray-700',
  red: 'bg-red-900/60 text-red-300 border-red-800',
  blue: 'bg-blue-900/60 text-blue-300 border-blue-800',
  gold: 'bg-amber-900/60 text-amber-300 border-amber-800',
  green: 'bg-green-900/60 text-green-300 border-green-800',
  orange: 'bg-orange-900/60 text-orange-300 border-orange-800',
  gray: 'bg-gray-800 text-gray-400 border-gray-700',
};

export const Pill = ({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}: PillProps) => (
  <span
    className={[
      'inline-flex items-center font-medium border rounded-full',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
      variantClasses[variant],
      className,
    ].join(' ')}
    {...props}
  >
    {children}
  </span>
);
