'use client';

import * as React from 'react';
import { createTranslator, getMessages } from '@myclash/i18n';
import { isFreshnessAlarming, type Freshness } from '../hooks/realtime-freshness';

export interface FreshnessChipProps {
  freshness: Freshness;
  /**
   * Locale for the chip's label. Defaults to the shipped default, matching how
   * every other packages/ui component resolves messages — the projector and the
   * TV board have no i18n provider to read from.
   */
  locale?: string;
  /**
   * Hide the chip while everything is fine.
   *
   * The default for an unattended surface — a projector should say nothing when
   * there is nothing to say. An attended one (a spectator's match page) is
   * better served by a permanent chip, because "no chip" and "chip I have not
   * noticed" look identical to someone glancing at a phone.
   */
  quietWhenLive?: boolean;
  className?: string;
}

/**
 * One chip for "how fresh is this?", across every live surface.
 *
 * Replaces three separate cues that disagreed: the TV board's raw amber/green
 * pills, the public match page's reconnecting banner, and the console-only
 * logging of `useRealtimeWithFallback`. The state it renders comes from
 * `deriveFreshness`, so what a surface SAYS and what it KNOWS can no longer
 * drift apart.
 *
 * Tokenized throughout. The chip it replaces on the TV board hard-coded
 * `amber-100`/`green-100`, which meant the one component in the app most likely
 * to be looked at from across a hall was also the one ignoring the theme.
 */
export function FreshnessChip({
  freshness,
  locale,
  quietWhenLive = false,
  className,
}: FreshnessChipProps) {
  const t = createTranslator(getMessages(locale));

  if (quietWhenLive && freshness.kind === 'live') return null;

  const alarming = isFreshnessAlarming(freshness);
  const tone = TONE[freshness.kind];

  return (
    <span
      // A live region: on an unattended board nobody is going to tab to this,
      // and a screen reader following a match should hear that updates stopped.
      role="status"
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide',
        tone.chip,
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <span
        className={[
          'h-2 w-2 rounded-full',
          tone.dot,
          // Pulse only while something is actually happening. A pulsing dot on a
          // stale board reads as activity, which is the opposite of the truth.
          alarming ? '' : 'animate-pulse',
        ]
          .join(' ')
          .trim()}
      />
      {t(labelKey(freshness))}
    </span>
  );
}

/**
 * Semantic tokens, one per state.
 *
 * `polling` is INFO, not warning: a working poll is slower, not broken, and
 * painting it amber is what would train an organiser to ignore the chip.
 */
const TONE: Record<Freshness['kind'], { chip: string; dot: string }> = {
  live: { chip: 'bg-success/15 text-success', dot: 'bg-success' },
  polling: { chip: 'bg-info/15 text-info', dot: 'bg-info' },
  stale: { chip: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  disabled: { chip: 'bg-muted/15 text-muted', dot: 'bg-muted' },
};

/** Literal keys, one per state — never assembled from a template. */
function labelKey(freshness: Freshness): string {
  switch (freshness.kind) {
    case 'live':
      return 'scoring.freshness.live';
    case 'polling':
      return 'scoring.freshness.polling';
    case 'stale':
      return 'scoring.freshness.stale';
    case 'disabled':
      return 'scoring.freshness.disabled';
  }
}
