import type { ReactNode } from 'react';

export type StatsGridProps = {
  cols?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
};

const colClass = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
} as const;

export function StatsGrid({ cols = 3, children, className }: StatsGridProps) {
  const root = ['grid grid-cols-1 gap-3', colClass[cols], className].filter(Boolean).join(' ');
  return <div className={root}>{children}</div>;
}
