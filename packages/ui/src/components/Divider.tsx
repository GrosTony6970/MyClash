import * as React from 'react';

export interface DividerProps {
  label?: string;
  className?: string;
  variant?: 'default' | 'gold';
}

export const Divider = ({ label, className = '', variant = 'default' }: DividerProps) => {
  const lineClass = variant === 'gold' ? 'border-amber-800' : 'border-gray-800';

  if (!label) {
    return <hr className={['border-t', lineClass, className].join(' ')} />;
  }

  return (
    <div className={['flex items-center gap-3', className].join(' ')}>
      <hr className={['flex-1 border-t', lineClass].join(' ')} />
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</span>
      <hr className={['flex-1 border-t', lineClass].join(' ')} />
    </div>
  );
};
