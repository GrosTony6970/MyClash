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
 *   - pendingReview                 → 'paused' (waiting on review;
 *                                     kept as an uppercase flag so it
 *                                     reads as urgent, not quiet)
 */

import { rulesetSemantic, statusPillTone } from '@myclash/ui';

export type RulesetBadgeVariant =
  | 'builtin'
  | 'custom'
  | 'default'
  | 'published'
  | 'draft'
  | 'pendingReview';

const BASE_CLASS = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';

export function RulesetBadge({ variant, label }: { variant: RulesetBadgeVariant; label: string }) {
  const tone = statusPillTone(rulesetSemantic(variant), 'light');
  if (variant === 'pendingReview') {
    // Pending review reads as an urgency flag: square corners,
    // uppercase. Tone stays canonical (amber).
    return (
      <span
        className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${tone.className}`}
      >
        {label}
      </span>
    );
  }
  return (
    <span className={`${BASE_CLASS} ${tone.className} ${tone.pulse ? 'animate-pulse' : ''}`}>
      {label}
    </span>
  );
}
