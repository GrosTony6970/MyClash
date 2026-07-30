'use client';

import { SkillBadge, sideColorsForTokens } from '@myclash/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type * as React from 'react';

type StatusTone = 'done' | 'live' | 'pending' | 'lost' | 'draw';

export interface CommitmentCardProps {
  kind: 'fight' | 'referee' | 'workshop';
  /** Already-formatted time (event-local) or the "TBD" label. */
  timeLabel: string;
  place?: string | null;
  title: string;
  meta?: string | null;
  status?: { label: string; tone: StatusTone };
  conflict?: string | null;
  isNext?: boolean;
  nextLabel?: string;
  /** Currently in progress — takes visual precedence over `isNext`. */
  isLive?: boolean;
  liveLabel?: string;
  /** Fighter side for the accent stripe (fights only). */
  side?: 'red' | 'blue';
  /**
   * The tournament's configured side colour tokens. The stripe tells a fighter
   * which corner they are in, so it has to be the corner the ORGANISER set —
   * this card used to paint a fixed red/blue regardless.
   */
  sideColors?: { red: string; blue: string } | null;
  /** Referee badge label (the skill name, e.g. "Déclarant"); defaults to "REF". */
  refLabel?: string;
  /** Referee skill color token (referee_skills.color), e.g. "orange"/"purple". */
  refColor?: string;
  href?: string;
}

// Accent stripe by kind: referee = orange (warning), workshop = green (success),
// fighter = the corner the ORGANISER configured for this tournament (encodes
// which corner the fighter is in, so it must match what they see on the piste).
// Semantic classes for the first two; a resolved hex for the third, since the
// colour is per-tournament data and cannot be a static class.
function stripeFor(
  kind: 'fight' | 'referee' | 'workshop',
  side?: 'red' | 'blue',
  sideColors?: { red: string; blue: string } | null,
): { className: string; style?: React.CSSProperties } {
  if (kind === 'referee') return { className: 'bg-warning' };
  if (kind === 'workshop') return { className: 'bg-success' };
  const colors = sideColorsForTokens(sideColors, 'light');
  return { className: '', style: { backgroundColor: colors[side ?? 'red'] } };
}

const toneClasses: Record<StatusTone, string> = {
  done: 'bg-success/15 text-success',
  live: 'bg-danger/15 text-danger',
  pending: 'bg-foreground/10 text-muted',
  lost: 'bg-foreground/10 text-muted',
  draw: 'bg-warning/15 text-warning',
};

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function CommitmentCard({
  kind,
  timeLabel,
  place,
  title,
  meta,
  status,
  conflict,
  isNext,
  nextLabel = 'Next',
  isLive,
  liveLabel = 'Live',
  side,
  sideColors,
  refLabel = 'REF',
  refColor,
  href,
}: CommitmentCardProps): ReactNode {
  const stripe = stripeFor(kind, side, sideColors);
  const inner = (
    <div
      className={[
        'relative flex gap-3 rounded-xl border bg-surface p-4 [touch-action:manipulation]',
        conflict ? 'border-l-4 border-l-danger border-border' : 'border-border',
        isLive ? 'ring-2 ring-danger' : isNext ? 'ring-2 ring-accent' : '',
      ].join(' ')}
    >
      {isLive ? (
        <span className="absolute -top-2 left-12 inline-flex items-center gap-1 rounded-md bg-danger px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-danger-foreground">
          <span
            className="h-1.5 w-1.5 rounded-full bg-danger-foreground animate-pulse motion-reduce:animate-none"
            aria-hidden
          />
          {liveLabel}
        </span>
      ) : (
        isNext && (
          <span className="absolute -top-2 left-12 rounded-md bg-accent px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-accent-foreground">
            {nextLabel}
          </span>
        )
      )}
      <span
        className={['w-1 shrink-0 self-stretch rounded', stripe.className].join(' ')}
        style={stripe.style}
        aria-hidden
      />
      <div className="flex min-w-[60px] flex-col items-start">
        <span className="text-xl font-extrabold leading-none tabular-nums">{timeLabel}</span>
        {place && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-foreground">
            <span className="text-accent">
              <PinIcon />
            </span>
            {place}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold leading-tight">{title}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-muted">{meta}</p>}
        {conflict && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            {conflict}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end justify-center gap-1.5">
        {kind === 'referee' && (
          <SkillBadge color={refColor ?? 'slate'} label={refLabel} size="sm" />
        )}
        {status && (
          <span
            className={[
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
              toneClasses[status.tone],
            ].join(' ')}
          >
            {status.tone === 'live' && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            )}
            {status.label}
          </span>
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
