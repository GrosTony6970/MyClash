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
        // Every app imports @myclash/ui/theme.css, so these tokens are always
        // defined and adapt light/dark automatically. (They used to carry dark
        // hex fallbacks that never fired and misdescribed the light surface.)
        'bg-surface border border-border rounded-xl',
        accent ? 'border-t-2 border-t-gold' : '',
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
    className={['font-display text-lg font-bold text-foreground', className].join(' ')}
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
  <div className={['text-foreground', className].join(' ')} {...props}>
    {children}
  </div>
);
