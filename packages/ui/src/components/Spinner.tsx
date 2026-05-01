import * as React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeMap = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' };

export const Spinner = ({ size = 'md', className = '', label = 'Loading…' }: SpinnerProps) => (
  <span role="status" aria-label={label} className={['inline-flex', className].join(' ')}>
    <span
      className={[
        'border-2 border-current border-t-transparent rounded-full animate-spin',
        sizeMap[size],
      ].join(' ')}
    />
    <span className="sr-only">{label}</span>
  </span>
);
