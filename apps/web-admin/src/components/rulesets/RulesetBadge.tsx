'use client';

/**
 * RulesetBadge — status pills across the three ruleset catalogues
 * (Scoring, Penalty, League). Sources its colour from the shared
 * `statusPillTone` palette in `@myclash/ui` so every status pill
 * across the app reads from the same canonical semantic map.
 *
 * Variants:
 *   - builtin / default / published → 'ready'  (the platform endorses it)
 *   - draft / custom                → 'pending' (still mutable)
 *   - archived                      → 'archived' (delisted; stone/grey)
 *   - pendingReview                 → 'paused' (waiting on review;
 *                                     kept as an uppercase flag so it
 *                                     reads as urgent, not quiet)
 */

import { rulesetSemantic, statusPillTone, StatusHelp } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';

export type RulesetBadgeVariant =
  | 'builtin'
  | 'custom'
  | 'default'
  | 'published'
  | 'draft'
  | 'archived'
  | 'pendingReview';

const BASE_CLASS = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';

export function RulesetBadge({ variant, label }: { variant: RulesetBadgeVariant; label: string }) {
  const { t } = useI18n();
  const tone = statusPillTone(rulesetSemantic(variant), 'light');
  // Every ruleset catalogue renders through here, so the explanation lands on
  // all three at once. Ruleset variants are the ones that genuinely surprise
  // people — "archived" delists a ruleset from the pickers but tournaments
  // that already pinned it keep scoring by it forever.
  const help = <StatusHelp domain="ruleset" status={variant} t={t} />;

  if (variant === 'pendingReview') {
    // Pending review reads as an urgency flag: square corners,
    // uppercase. Tone stays canonical (amber).
    return (
      <span className="inline-flex items-center">
        <span
          className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${tone.className}`}
        >
          {label}
        </span>
        {help}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center">
      <span className={`${BASE_CLASS} ${tone.className} ${tone.pulse ? 'animate-pulse' : ''}`}>
        {label}
      </span>
      {help}
    </span>
  );
}
