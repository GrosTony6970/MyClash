import * as React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) => (
  <div
    className={['flex flex-col items-center justify-center text-center py-16 px-8', className].join(
      ' ',
    )}
  >
    {icon && <div className="text-5xl mb-4 text-muted">{icon}</div>}
    <h3 className="font-display text-lg font-bold text-foreground mb-2">{title}</h3>
    {description && <p className="text-muted text-sm max-w-sm">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
