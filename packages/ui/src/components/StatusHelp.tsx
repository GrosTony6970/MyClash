'use client';

import * as React from 'react';
import { HelpTooltip } from './HelpTooltip';
import { hasStatusHelp, statusHelpKeys, type StatusHelpDomain } from '../utils/status-help';

export interface StatusHelpProps {
  domain: StatusHelpDomain;
  /** The raw status string as stored, e.g. 'draft', 'checked_in'. */
  status: string;
  /** Translator from the host app — packages/ui has no provider of its own. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * Explains one status chip: what it means, what happens next, and who can do
 * it — the three questions a coloured pill never answers.
 *
 * Drops in NEXT TO a chip however that chip is rendered, rather than requiring
 * every chip to route through `StatusBadge` first. `status-pill.ts` claims
 * every pill pipes through its mappers; it does not — `<StatusBadge>` appears
 * on three product surfaces while roughly a dozen more call `statusPillTone`
 * directly. Consolidating first would be a cross-app refactor before any of
 * this reached a user, so this composes instead. Consolidation stays worth
 * doing on its own.
 *
 * Renders NOTHING for a status with no copy. A status vocabulary that grows —
 * and they do — must not start showing an ⓘ that opens onto raw key names.
 */
export const StatusHelp: React.FC<StatusHelpProps> = ({ domain, status, t }) => {
  if (!hasStatusHelp(domain, status)) return null;
  const keys = statusHelpKeys(domain, status);

  return (
    <HelpTooltip ariaLabel={t('statusHelp.triggerLabel', { status: t(keys.means) })}>
      <span className="flex flex-col gap-1.5">
        <StatusHelpField label={t('statusHelp.fields.means')} value={t(keys.means)} />
        <StatusHelpField label={t('statusHelp.fields.next')} value={t(keys.next)} />
        <StatusHelpField label={t('statusHelp.fields.who')} value={t(keys.who)} />
      </span>
    </HelpTooltip>
  );
};

function StatusHelpField({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="block">{value}</span>
    </span>
  );
}
