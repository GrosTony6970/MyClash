'use client';

/**
 * MatchTimeline — the shared render of the unified scoring timeline built by
 * `buildUnifiedTimeline`. One numbered list of exchanges + cards, newest
 * first, used by all three surfaces that show a match's history:
 *
 *   - the referee scoring pad's centre column   (scale 'compact', config colours)
 *   - the TV / external display's centre column (scale 'tv',      config colours)
 *   - the public match page                     (scale 'page',    token colours)
 *
 * The `#N` numbering comes from the builder and is identical on all three, so
 * an operator on the pad and a spectator on the projector are looking at the
 * same event when they say "number 6".
 *
 * OVERFLOW: the TV centre grid track is `minmax(380px, 28%)`, which resolves to
 * a hard 380px on any projector under ~1405px wide, inside a `w-screen
 * overflow-hidden` stage — so an over-wide row clips over the score numeral
 * instead of scrolling. Only the fighter names flex and truncate; everything
 * fixed-width is `flex-shrink-0`. The chain needs `min-w-0` on every flexible
 * child AND `w-full` on the root (the TV centre column is `items-center`,
 * which does not stretch its children).
 */

import * as React from 'react';
import { useEffect, useRef } from 'react';
import type { UnifiedEvent } from '../utils/exchange-timeline';
import type { PenaltyCard } from '../types/match-events';
import { legibleOn } from '../utils/side-color';

export type MatchTimelineScale = 'compact' | 'tv' | 'page';

export interface MatchTimelineProps {
  /** Rows from `buildUnifiedTimeline` — already ordered newest-first. */
  events: UnifiedEvent[];
  /**
   * Typography + surface treatment.
   *   'compact' — the pad's dense scroll box on a dark panel.
   *   'tv'      — projector-sized on the dark stage.
   *   'page'    — full-page document flow: no height cap, no scroll box, no
   *               auto-pin. Use on surfaces the reader scrolls themselves; a
   *               nested scroller there traps keyboard users and yanks the view
   *               back to the top every time a live event lands.
   */
  scale?: MatchTimelineScale;
  /** Shown when there are no events. Defaults to an em dash. */
  emptyLabel?: string;
  /**
   * Shared timeline number to spotlight, or null. Paired with the bout-flow
   * chart on the surfaces that show both: scrubbing the chart lights the row,
   * and pointing at a row lights the chart. Both key off `ev.number`, which is
   * the same figure on every surface by construction.
   */
  highlightNumber?: number | null;
  /** Provide to let rows drive the highlight. Omit for a static list. */
  onHighlightChange?: (n: number | null) => void;
  /** Accessible name for the list. */
  ariaLabel?: string;
  /** App-local translator — packages/ui has no i18n context of its own. */
  t: (key: string, params?: Record<string, string>) => string;
  className?: string;
}

// Card → swatch colour for the timeline penalty icon. Mirrors the per-side
// counter chips in the scoring pad's ScoringColumn.
const CARD_CHIP_COLOR: Record<PenaltyCard, string> = {
  yellow: 'bg-yellow-500',
  red: 'bg-red-600',
  black: 'bg-gray-900 border border-gray-600',
};

interface ScaleStyles {
  box: string;
  row: string;
  num: string;
  time: string;
  dot: string;
  name: string;
  type: string;
  delta: string;
  muted: string;
  icon: string;
  empty: string;
  card: string;
  /** Spell the card colour out as text rather than relying on the swatch. */
  cardText: boolean;
  /** Applied to the row the chart (or the pointer) is currently on. */
  rowActive: string;
}

const COMPACT: ScaleStyles = {
  box: 'max-h-[260px] overflow-y-auto rounded-lg border border-border bg-background p-2 space-y-1',
  row: 'flex items-center gap-2 text-sm py-0.5',
  num: 'font-mono text-muted tabular-nums w-7 flex-shrink-0',
  time: 'font-mono text-muted tabular-nums flex-shrink-0',
  dot: 'inline-block h-2 w-2 rounded-full flex-shrink-0',
  name: 'font-semibold text-foreground truncate min-w-0 flex-auto',
  type: 'text-muted truncate min-w-0',
  delta: 'font-bold text-foreground flex-shrink-0',
  muted: 'text-muted',
  icon: 'text-warning flex-shrink-0',
  empty: 'text-center text-xs text-muted py-2',
  card: 'inline-block h-3.5 w-3.5 rounded-sm flex-shrink-0',
  cardText: false,
  rowActive: 'bg-surface rounded-md -mx-1 px-1',
};

const STYLES: Record<MatchTimelineScale, ScaleStyles> = {
  compact: COMPACT,
  // Same dense row, but in normal page flow with room to name the card.
  page: {
    ...COMPACT,
    box: 'rounded-lg border border-border bg-surface p-3 space-y-1 shadow-xs',
    empty: 'text-center text-sm text-muted py-6',
    cardText: true,
    rowActive: 'bg-background rounded-md -mx-1 px-1',
  },
  // Explicit dark-stage classes, NOT semantic tokens: the display stage is a
  // hardcoded bg-gray-950 inside light-themed apps, so text-foreground and
  // friends would render dark-on-dark.
  tv: {
    box: 'max-h-[42vh] overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-1.5',
    // Fluid: rows that keep an 18px cap on a projector but shrink with the
    // stage in a window, so they stop pushing into the score numerals.
    row: 'flex items-center gap-2 text-stage-row py-0.5',
    num: 'font-mono text-gray-500 tabular-nums w-9 flex-shrink-0',
    time: 'font-mono text-gray-400 tabular-nums flex-shrink-0',
    dot: 'inline-block h-3 w-3 rounded-full flex-shrink-0',
    name: 'font-semibold text-gray-100 truncate min-w-0 flex-auto',
    type: 'text-gray-400 truncate min-w-0',
    delta: 'font-bold text-gray-100 flex-shrink-0',
    muted: 'text-gray-500',
    icon: 'text-amber-400 flex-shrink-0',
    empty: 'text-center text-base text-gray-600 py-2',
    card: 'inline-block h-4 w-4 rounded-sm flex-shrink-0',
    cardText: false,
    rowActive: 'bg-gray-800 rounded-md -mx-1 px-1',
  },
};

export function MatchTimeline({
  events,
  scale = 'compact',
  emptyLabel,
  highlightNumber = null,
  onHighlightChange,
  ariaLabel,
  t,
  className,
}: MatchTimelineProps): React.ReactElement {
  const s = STYLES[scale];
  const scrolls = scale !== 'page';
  const listRef = useRef<HTMLOListElement | null>(null);

  // Rows are newest-first, so pinning to the top keeps the latest event in
  // view — the pad and the projector have no one free to scroll them. Skipped
  // on 'page', where the reader owns the scroll position.
  useEffect(() => {
    if (scrolls && listRef.current) listRef.current.scrollTop = 0;
  }, [events.length, scrolls]);

  // Follow the highlight into view — a spotlight below the fold of a 260px
  // scroll box highlights nothing. Deliberately NOT keyed on events.length, so
  // it never fights the pin-to-top above; 'nearest' keeps the page still on the
  // scale that has no scroll box of its own.
  useEffect(() => {
    if (!scrolls || highlightNumber === null) return;
    listRef.current
      ?.querySelector(`[data-event-number="${highlightNumber}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlightNumber, scrolls]);

  /** Dot styling: the side's configured colour as an inline hex. */
  function dotProps(hex: string | null | undefined) {
    if (!hex) return null;
    // The TV stage is near-black: clamp a black-configured side so its dot
    // doesn't vanish, exactly as the big score numerals do.
    return {
      className: s.dot,
      style: { backgroundColor: scale === 'tv' ? legibleOn(hex, 'dark') : hex },
    };
  }

  return (
    <ol
      ref={listRef}
      // tabIndex on a scrollable region: without it, a keyboard-only user can
      // never reach the rows below the fold.
      {...(scrolls ? { tabIndex: 0, role: 'region' } : {})}
      aria-label={ariaLabel}
      className={`w-full ${s.box} ${className ?? ''}`}
    >
      {events.length === 0 && <li className={s.empty}>{emptyLabel ?? '—'}</li>}
      {events.map((ev) => {
        const dot = dotProps(ev.sideColor);
        const oppDot = dotProps(ev.opponentSideColor);
        // Card severity is otherwise carried by colour alone — unreadable to a
        // colour-blind viewer, and `title` never fires on touch.
        const cardLabel = ev.card ? t(`scoring.penalties.cards.${ev.card}`) : null;
        const active = ev.number === highlightNumber;
        return (
          <li
            key={ev.id}
            data-event-number={ev.number}
            className={`${s.row}${active ? ` ${s.rowActive}` : ''}`}
            {...(onHighlightChange
              ? {
                  onPointerEnter: () => onHighlightChange(ev.number),
                  onPointerLeave: () => onHighlightChange(null),
                }
              : {})}
          >
            <span className={s.num}>#{ev.number}</span>
            <span className={s.time}>{ev.timeLabel}</span>
            {dot && <span {...dot} />}
            {ev.fighterLabel && <span className={s.name}>{ev.fighterLabel}</span>}
            {ev.card && cardLabel && (
              <>
                <span
                  role="img"
                  aria-label={cardLabel}
                  title={cardLabel}
                  className={`${s.card} ${CARD_CHIP_COLOR[ev.card]}`}
                />
                {s.cardText && <span className={`${s.muted} flex-shrink-0`}>{cardLabel}</span>}
              </>
            )}
            {ev.icon && (
              <span className={s.icon} aria-hidden>
                {ev.icon}
              </span>
            )}
            <span className={s.type}>
              {ev.typeLabel}
              {ev.note ? ` — ${ev.note}` : ''}
            </span>
            {ev.forfeit && (
              <span className={`${s.muted} truncate min-w-0`}>
                {t('scoring.liveMatch.matchLost')}
              </span>
            )}
            {ev.delta && <span className={s.delta}>{ev.delta}</span>}
            {ev.opponentDelta && (
              // Shrinkable, so the afterblow defender's name yields before the
              // striker's — the striker is the one the row is about.
              <span className="flex min-w-0 items-center gap-1">
                <span className={`${s.muted} flex-shrink-0`}>·</span>
                {oppDot && <span {...oppDot} />}
                {ev.opponentLabel && (
                  <span className={`${s.muted} truncate min-w-0 max-w-[6rem]`}>
                    {ev.opponentLabel}
                  </span>
                )}
                <span className={s.delta}>{ev.opponentDelta}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
