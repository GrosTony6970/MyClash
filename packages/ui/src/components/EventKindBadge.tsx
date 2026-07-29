import * as React from 'react';
import type { EventKind } from '@myclash/types';

export interface EventKindBadgeProps {
  kind: EventKind;
  /**
   * The translated label. Passed in rather than resolved here: the i18n
   * reverse sweep scans packages/ui too, and key ownership belongs to the app
   * that renders the badge, not to the primitive.
   */
  label: string;
  /** Optional hover/assistive text explaining what the kind means. */
  title?: string;
  size?: 'sm' | 'md';
  /** Positioning only (e.g. `ml-2 align-middle`). Never colour. */
  className?: string;
}

/**
 * Tags an event that is not a normal competition.
 *
 * Renders nothing for `standard` — the overwhelmingly common case needs no
 * chrome, so callers can drop this in unconditionally.
 *
 * Not built on StatusBadge on purpose: that primitive's vocabulary is
 * lifecycle state (pending/live/done/…) and "Club event" is not a status, it
 * is what the event *is*. Its palette is also raw Tailwind rather than semantic
 * tokens, which this badge sits next to.
 *
 *   test → warning tokens (matches the chip this replaced, so the admin events
 *          list is a pure refactor with no visual change)
 *   club → info tokens, visibly distinct from test
 */
export function EventKindBadge({
  kind,
  label,
  title,
  size = 'sm',
  className,
}: EventKindBadgeProps): React.ReactElement | null {
  if (kind === 'standard') return null;

  const tone =
    kind === 'club'
      ? 'border-info/30 bg-info/10 text-info'
      : 'border-warning/30 bg-warning/10 text-warning';

  return (
    <span
      title={title}
      className={[
        'inline-flex items-center rounded-full border px-2 font-bold uppercase tracking-wide',
        size === 'sm' ? 'py-0.5 text-[10px]' : 'py-1 text-xs',
        tone,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
    </span>
  );
}
