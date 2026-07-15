import * as React from 'react';

/**
 * DataTable — the shared admin list table (Tournament Manual aesthetic).
 *
 *   • Plain `border-b border-border` under the header — no header fill.
 *   • Hairline row separators, hover lift (`hover:bg-background`).
 *   • Header text in small caps, muted, tight tracking.
 *   • Body text in foreground-secondary.
 *   • Wrapped in `overflow-x-auto` for mobile.
 *
 * Fully tokenized (surface/border/muted/foreground-secondary) so it themes
 * correctly. Compose with <DataTableHead>, <DataTableRow>, <DataTableCell>.
 * Codes/slugs go through a `mono` cell.
 */
export interface DataTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export const DataTable: React.FC<DataTableProps> = ({ children, className = '', ...props }) => (
  <div className="overflow-x-auto rounded-lg border border-border bg-surface">
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
        'border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted',
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
      'border-b border-border/60 transition-colors last:border-b-0 hover:bg-background',
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
    as === 'th'
      ? 'px-5 py-3 font-semibold text-muted'
      : 'px-5 py-4 align-top text-foreground-secondary';
  const Tag = as;
  return (
    <Tag
      className={[baseClasses, mono ? 'font-mono text-xs text-muted' : '', className].join(' ')}
      {...props}
    >
      {children}
    </Tag>
  );
};
