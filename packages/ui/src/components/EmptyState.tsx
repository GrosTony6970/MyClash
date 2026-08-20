import * as React from 'react';

import { FoilMark } from './FoilMark';

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
    {/* Above the title, not below it: `title` is the only required prop, so the
        flourish always has something to introduce. Below it the hairline dangles
        on the many call sites that pass a title alone. `text-muted` explicitly —
        FoilMark's own default is `text-slate-300`, a raw palette class no token
        carries (known-deviations D5), and this component renders it 18 times. */}
    <FoilMark className="text-muted mb-3" width={28} />
    <h3 className="font-display text-lg font-bold text-foreground mb-2">{title}</h3>
    {description && <p className="text-muted text-sm max-w-sm">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
