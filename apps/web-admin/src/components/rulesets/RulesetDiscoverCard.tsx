'use client';

import Link from 'next/link';
import { useI18n } from '../../i18n/I18nProvider';

export interface RulesetDiscoverCardProps {
  name: string;
  version: string;
  description: string | null;
  /** A platform built-in (any org may adopt) vs another org's shared row. */
  isBuiltIn: boolean;
  /**
   * The sharing org's display name. Null for built-ins; may also be null if a
   * shared ruleset's owning org could not be resolved (deleted org) — the card
   * falls back to a generic "another organization" label in that case.
   */
  ownerOrganizationName: string | null;
  /** For a coded fork: the name of the built-in it reuses. Renders a lineage line. */
  forkedFromName?: string | null;
  /** Small metadata pills (grammar summary / scope), pre-labelled by the page. */
  chips?: string[];
  /** Adopt = clone into the caller's org (the shared clone flow). */
  adoptHref: string;
  /** Read-only detail. */
  viewHref: string;
}

/**
 * One ruleset in the Discover catalog: an adoptable ruleset the org does not
 * own. Presentational — the page supplies the data and metadata chips; the card
 * owns only its shared chrome (source line, Adopt/View, lineage line). Shared by
 * the scoring and penalty Discover tabs so both attribute a shared ruleset by
 * org name, never a raw UUID.
 */
export function RulesetDiscoverCard({
  name,
  version,
  description,
  isBuiltIn,
  ownerOrganizationName,
  forkedFromName,
  chips = [],
  adoptHref,
  viewHref,
}: RulesetDiscoverCardProps) {
  const { t } = useI18n();
  const sourceLabel = isBuiltIn
    ? t('admin.rulesets.discover.builtinSource')
    : t('admin.rulesets.discover.sharedBy', {
        org: ownerOrganizationName ?? t('admin.rulesets.discover.anotherOrg'),
      });

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-semibold text-foreground">{name}</h3>
        <span className="shrink-0 font-mono text-xs font-bold text-muted">{version}</span>
      </div>

      <p className="text-xs font-medium text-foreground-secondary">
        <span
          className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isBuiltIn ? 'bg-success/10 text-success' : 'bg-info/10 text-info'
          }`}
        >
          {isBuiltIn ? t('admin.rulesets.shared.badges.builtin') : t('admin.rulesets.sourceShared')}
        </span>
        {sourceLabel}
      </p>

      {forkedFromName && (
        <p className="mt-1 text-xs text-info">
          {t('admin.rulesets.forkedFrom', { base: forkedFromName })}
        </p>
      )}

      {description && <p className="mt-2 line-clamp-3 text-xs text-muted">{description}</p>}

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground-secondary"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 pt-1">
        <Link
          href={adoptHref}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t('admin.rulesets.discover.adopt')}
        </Link>
        <Link
          href={viewHref}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
        >
          {t('admin.rulesets.viewAction')}
        </Link>
      </div>
    </div>
  );
}
