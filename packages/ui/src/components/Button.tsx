import * as React from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'gold'
  | 'back'
  | 'cancel';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  // `primary` is accent-aware: apps that define --color-accent (web-public:
  // red on light, blue under data-accent="personal") get it; others (web-admin,
  // web-scoring) fall back to the brand red so nothing changes for them.
  primary:
    'bg-[var(--color-accent,#b91c1c)] hover:bg-[var(--color-accent-hover,#991b1b)] active:bg-[var(--color-accent-hover,#991b1b)] text-[var(--color-accent-foreground,#ffffff)] border-transparent shadow-sm',
  secondary:
    'bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white border-transparent shadow-sm',
  ghost:
    'bg-transparent hover:bg-white/10 active:bg-white/20 text-white border-white/20 hover:border-white/40',
  danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border-transparent shadow-sm',
  gold: 'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-gray-900 border-transparent font-bold shadow-[0_0_12px_rgb(245_158_11_/_0.4)]',
  back: 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border-slate-300 shadow-sm',
  cancel: 'bg-transparent hover:bg-slate-100 active:bg-slate-200 text-slate-600 border-transparent',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-md gap-1.5',
  md: 'px-4 py-2 text-sm rounded-lg gap-2',
  lg: 'px-6 py-3 text-base rounded-xl gap-2',
  xl: 'px-8 py-4 text-lg rounded-xl gap-3',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      className = '',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled ?? loading}
        aria-busy={loading || undefined}
        className={[
          'inline-flex items-center justify-center font-semibold border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  },
);

Button.displayName = 'Button';
