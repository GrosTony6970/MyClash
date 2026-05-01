import * as React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Breadcrumb or back link. */
  back?: React.ReactNode;
  /** Right-side actions. */
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader = ({ title, subtitle, back, actions, className = '' }: PageHeaderProps) => (
  <header className={['mb-8', className].join(' ')}>
    {back && <div className="mb-2 text-sm text-gray-500">{back}</div>}
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-gray-400 text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  </header>
);
