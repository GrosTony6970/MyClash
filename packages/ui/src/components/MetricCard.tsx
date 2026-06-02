import type { CSSProperties, ReactNode } from 'react';

export type MetricCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function MetricCard({ label, value, detail, className, style }: MetricCardProps) {
  const root = ['rounded-md border border-slate-200 bg-white p-5', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={root} style={style}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-medium tracking-tight text-slate-900">
        {value}
      </div>
      {detail ? <div className="mt-1 text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}
