'use client';

/**
 * RulesetBadge — single source of truth for status pills across the
 * three ruleset catalogues (Scoring, Penalty, League). Replaces the
 * three divergent palettes that used to render the same semantic
 * concept (built-in / custom / default / published / draft) with
 * different colors per tab.
 */

export type RulesetBadgeVariant =
  | 'builtin'
  | 'custom'
  | 'default'
  | 'published'
  | 'draft'
  | 'pendingReview';

const BASE_CLASS = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const VARIANT_CLASS: Record<RulesetBadgeVariant, string> = {
  builtin: 'bg-purple-100 text-purple-700',
  custom: 'bg-blue-100 text-blue-700',
  default: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-700',
  draft: 'bg-slate-200 text-slate-600',
  // Pending review is an urgency tag, not a status pill — kept square
  // + uppercase to read as a flag rather than a quiet badge.
  pendingReview:
    'rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800',
};

export function RulesetBadge({ variant, label }: { variant: RulesetBadgeVariant; label: string }) {
  if (variant === 'pendingReview') {
    return <span className={VARIANT_CLASS[variant]}>{label}</span>;
  }
  return <span className={`${BASE_CLASS} ${VARIANT_CLASS[variant]}`}>{label}</span>;
}
