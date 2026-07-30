import * as React from 'react';

// No 'red'/'blue' variants: nothing consumed them, and a generic pill named
// after a fighter's colour is how the hardcode spreads. A side-coloured chip
// resolves through `sideStyle()` instead.
export type PillVariant = 'default' | 'gold' | 'green' | 'orange' | 'gray';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  size?: 'sm' | 'md';
}

const variantClasses: Record<PillVariant, string> = {
  default: 'bg-gray-800 text-gray-300 border-gray-700',
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
