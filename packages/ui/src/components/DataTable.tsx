import * as React from 'react';

/**
 * DataTable — light-mode tables for admin.myclash.fr.
 *
 * Tournament Manual aesthetic:
 *   • Plain `border-b border-slate-200` under the header — no header fill.
 *   • Hairline `border-b border-slate-100` row separators.
 *   • Hover lift on rows: `hover:bg-slate-50/60` with `transition-colors`.
 *   • Header text in small caps, slate-500, tight tracking.
 *   • Body text in slate-700.
 *   • Wrapped in `overflow-x-auto` for mobile.
 *
 * Compose with <DataTableHead>, <DataTableRow>, <DataTableCell>.
 * Codes/slugs go through <code className="font-mono"> inside a cell.
 */
export interface DataTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export const DataTable: React.FC<DataTableProps> = ({ children, className = '', ...props }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table className={['w-full border-collapse text-sm', className].join(' ')} {...props}>
      {children}
    </table>
  </div>
);

export const DataTableHead: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <thead>
    <tr
      className={[
        'border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500',
        className,
      ].join(' ')}
    >
      {children}
    </tr>
  </thead>
);

export interface DataTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children: React.ReactNode;
}

export const DataTableRow: React.FC<DataTableRowProps> = ({
  children,
  className = '',
  ...props
}) => (
  <tr
    className={[
      'border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/60',
      className,
    ].join(' ')}
    {...props}
  >
    {children}
  </tr>
);

export interface DataTableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  as?: 'td' | 'th';
  /** Apply JetBrains Mono for slugs / codes / UUIDs. */
  mono?: boolean;
  children?: React.ReactNode;
}

export const DataTableCell: React.FC<DataTableCellProps> = ({
  children,
  className = '',
  as = 'td',
  mono = false,
  ...props
}) => {
  const baseClasses =
    as === 'th' ? 'px-5 py-3 font-semibold text-slate-500' : 'px-5 py-4 text-slate-700 align-top';
  const Tag = as;
  return (
    <Tag
      className={[baseClasses, mono ? 'font-mono text-xs text-slate-500' : '', className].join(' ')}
      {...props}
    >
      {children}
    </Tag>
  );
};
