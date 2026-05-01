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
        'bg-gray-900 border border-gray-800 rounded-xl',
        accent ? 'border-t-2 border-t-amber-500' : '',
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
  <h3 className={['font-display text-lg font-bold text-white', className].join(' ')} {...props}>
    {children}
  </h3>
);

export const CardBody = ({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={['text-gray-300', className].join(' ')} {...props}>
    {children}
  </div>
);
