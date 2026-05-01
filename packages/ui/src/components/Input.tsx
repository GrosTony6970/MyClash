import * as React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftAddon, rightAddon, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <div className="flex items-center">
          {leftAddon && (
            <span className="px-3 py-2 bg-gray-800 border border-r-0 border-gray-700 rounded-l-lg text-gray-400 text-sm">
              {leftAddon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              'flex-1 bg-gray-900 border border-gray-700 text-white placeholder-gray-500',
              'px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              error ? 'border-red-500 focus:ring-red-500' : '',
              leftAddon ? 'rounded-r-lg' : rightAddon ? 'rounded-l-lg' : 'rounded-lg',
              className,
            ].join(' ')}
            {...props}
          />
          {rightAddon && (
            <span className="px-3 py-2 bg-gray-800 border border-l-0 border-gray-700 rounded-r-lg text-gray-400 text-sm">
              {rightAddon}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
