'use client';

/**
 * RulesetBadge — status pills across the three ruleset catalogues
 * (Scoring, Penalty, League). A thin wrapper over the shared `StatusBadge`:
 * this file's only job is translating a ruleset variant into a semantic and
 * attaching the help affordance.
 *
 * Variants:
 *   - builtin / default / published → 'ready'  (the platform endorses it)
 *   - draft / custom                → 'pending' (still mutable)
 *   - archived                      → 'archived' (delisted; stone/grey)
 *   - pendingReview                 → 'paused' (waiting on review;
 *                                     kept as an uppercase flag so it
 *                                     reads as urgent, not quiet)
 */

import { rulesetSemantic, StatusBadge, StatusHelp } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';

export type RulesetBadgeVariant =
  'builtin' | 'custom' | 'default' | 'published' | 'draft' | 'archived' | 'pendingReview';

export function RulesetBadge({ variant, label }: { variant: RulesetBadgeVariant; label: string }) {
  const { t } = useI18n();
  // Pending review reads as an urgency flag: square corners, uppercase.
  // Tone stays canonical (amber) either way.
  const isFlag = variant === 'pendingReview';

  return (
    <span className="inline-flex items-center">
      <StatusBadge
        semantic={rulesetSemantic(variant)}
        size="sm"
        shape={isFlag ? 'flag' : 'pill'}
        className={isFlag ? 'uppercase tracking-wide' : ''}
      >
        {label}
      </StatusBadge>
      {/* Every ruleset catalogue renders through here, so the explanation
          lands on all three at once. Ruleset variants are the ones that
          genuinely surprise people — "archived" delists a ruleset from the
          pickers but tournaments that already pinned it keep scoring by it
          forever. */}
      <StatusHelp domain="ruleset" status={variant} t={t} />
    </span>
  );
}
