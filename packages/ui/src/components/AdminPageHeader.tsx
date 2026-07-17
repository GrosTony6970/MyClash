import * as React from 'react';
import { FoilMark } from './FoilMark';

/**
 * AdminPageHeader — canonical top-of-page header for admin.myclash.fr.
 *
 * Tournament Manual aesthetic:
 *   • Eyebrow in small caps red, with the FoilMark hairline beneath it.
 *   • H1 in Fraunces (font-display) — expressive serif.
 *   • Subtitle in Geist (inherits from <body>).
 *   • Optional right-aligned action slot.
 *
 * Replaces the per-page `<h1 className="text-2xl font-bold">…</h1>` pattern
 * so spacing, typography, and the signature foil mark stay consistent.
 */
export interface AdminPageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  subtitle,
  eyebrow,
  actions,
  className = '',
}) => (
  <header
    className={[
      'mb-10 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between',
      className,
    ].join(' ')}
  >
    <div className="min-w-0">
      {eyebrow ? (
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-800">
          <span>{eyebrow}</span>
          <FoilMark className="text-slate-300" width={28} />
        </p>
      ) : null}
      <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl leading-tight tracking-tight text-foreground">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-secondary">
          {subtitle}
        </p>
      ) : null}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </header>
);
