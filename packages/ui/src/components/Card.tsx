import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds a gold top border accent. */
  accent?: boolean;
  /** Removes padding. */
  noPadding?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ accent = false, noPadding = false, className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={[
        // Token-aware with current dark values as fallback: web-public (which
        // defines --color-*) adapts light/dark; web-admin/web-scoring keep the
        // current gray look via the fallbacks.
        'bg-[var(--color-surface,#111827)] border border-[var(--color-border,#1f2937)] rounded-xl',
        accent ? 'border-t-2 border-t-[var(--color-gold,#f59e0b)]' : '',
        noPadding ? '' : 'p-6',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  ),
);

Card.displayName = 'Card';

export const CardHeader = ({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={['mb-4', className].join(' ')} {...props}>
    {children}
  </div>
);

export const CardTitle = ({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={[
      'font-display text-lg font-bold text-[var(--color-foreground,#ffffff)]',
      className,
    ].join(' ')}
    {...props}
  >
    {children}
  </h3>
);

export const CardBody = ({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={['text-[var(--color-foreground,#d1d5db)]', className].join(' ')} {...props}>
    {children}
  </div>
);
