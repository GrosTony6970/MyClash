import * as React from 'react';
import { accentClassFor, tintBgClassFor } from '../../utils/color-token';
import type { BracketSlotData, ColorToken } from './types';

export interface MatchCardProps {
  slot: BracketSlotData;
  redColor?: ColorToken;
  blueColor?: ColorToken;
  onClick?: (matchId: string | null, slotId: string, liceId: string | null) => void;
  onOverride?: (slotId: string) => void;
  /** Registers the card's outer element for connector geometry. */
  registerRef?: (slotId: string, el: HTMLDivElement | null) => void;
  /**
   * Render this card with the championship-final accent (gold border + glow).
   * Driven from `BracketView` — the last main-round non-bronze slot.
   */
  isChampionshipMatch?: boolean;
  /**
   * Render with the bronze-match style (dashed border, bronze accent).
   * Set by the bronze block in `BracketView`.
   */
  isBronzeMatch?: boolean;
  /**
   * Short human-readable identifier for this match (e.g. `LSW-QF-M1`).
   * Computed by the caller via `formatRoundCode` from `@myclash/types` —
   * the card doesn't know about weapons, pools, or bracket sizes.
   */
  roundCode?: string;
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700' };
    case 'running':
      return { label: 'Live', cls: 'bg-amber-100 text-amber-800' };
    case 'ready':
      return { label: 'Ready', cls: 'bg-amber-100 text-amber-700' };
    case 'forfeit':
      return { label: 'WO', cls: 'bg-slate-200 text-slate-600' };
    case 'disqualified':
      return { label: 'DQ', cls: 'bg-slate-200 text-slate-600' };
    default:
      return { label: 'Pending', cls: 'bg-slate-100 text-slate-600' };
  }
}

export function MatchCard({
  slot,
  redColor = 'red',
  blueColor = 'blue',
  onClick,
  onOverride,
  registerRef,
  isChampionshipMatch = false,
  isBronzeMatch = false,
  roundCode,
}: MatchCardProps) {
  const isTbd =
    (slot.redFighterName === null || slot.blueFighterName === null) && slot.status !== 'completed';
  const isLive = slot.status === 'running';
  const isReadyOrLive = slot.status === 'ready' || slot.status === 'running';
  const isCompleted = slot.status === 'completed';
  const pill = statusPill(slot.status);
  const redWins = isCompleted && winsThisRow('red', slot);
  const blueWins = isCompleted && winsThisRow('blue', slot);

  const handleClick = onClick
    ? () => onClick(slot.matchId, slot.id, slot.liceId ?? null)
    : undefined;

  // Border + background priority: championship > bronze > TBD > ready/live > default.
  const borderClass = isChampionshipMatch
    ? 'border border-amber-400 ring-1 ring-amber-200 shadow-amber-100/40'
    : isBronzeMatch
      ? 'border border-dashed border-amber-700/60'
      : isTbd
        ? 'border border-dashed border-slate-300'
        : isReadyOrLive
          ? 'border border-amber-200'
          : 'border border-slate-200';
  // Outer fill stays neutral white — the per-row tint set by each
  // FighterRow does the colour-coding. Adding an amber/slate card
  // background here would fight the row tints visually.
  const cardClasses = [
    'group relative flex h-[52px] w-full min-w-[220px] max-w-[360px] items-stretch overflow-hidden rounded-md bg-white shadow-sm transition-shadow',
    borderClass,
    handleClick ? 'cursor-pointer hover:shadow-md' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const refCallback = React.useCallback(
    (el: HTMLDivElement | null) => {
      registerRef?.(slot.id, el);
    },
    [registerRef, slot.id],
  );

  return (
    // Outer wrapper holds the card + its pill row + the override button.
    // The width constraint moves here so the pill row tracks the card's
    // resolved width (it's a flex column — children stretch to the
    // wrapper's width which equals the card's).
    <div className="relative flex w-full min-w-[220px] max-w-[360px] flex-col gap-1.5">
      <div
        ref={refCallback}
        role={handleClick ? 'button' : undefined}
        tabIndex={handleClick ? 0 : undefined}
        onClick={handleClick}
        onKeyDown={
          handleClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClick();
              }
            : undefined
        }
        className={cardClasses}
      >
        {/* Stacked fighter rows. The two side colours render
            horizontally: each row owns a left stripe + tinted
            background driven by its sideColor (sourced from the
            tournament's scoring_config.display.sideColors). */}
        <div className="flex flex-1 flex-col">
          <FighterRow
            name={slot.redFighterName}
            club={slot.redClubAbbrev}
            score={slot.redScore}
            highlight={redWins}
            isCompleted={isCompleted}
            sideColor={redColor}
          />
          <FighterRow
            name={slot.blueFighterName}
            club={slot.blueClubAbbrev}
            score={slot.blueScore}
            highlight={blueWins}
            isCompleted={isCompleted}
            sideColor={blueColor}
          />
        </div>
      </div>

      {/* Pills row sits BELOW the card (no overlap). Round code left,
          status pill right, justify-between keeps them anchored to
          the card edges. The empty span on the round-code side is
          rendered as a flex placeholder when roundCode is undefined
          so the status pill stays right-aligned. */}
      <div className="flex items-center justify-between px-1">
        {roundCode ? (
          <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide text-slate-50">
            {roundCode}
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.cls}`}
        >
          {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />}
          {pill.label}
        </span>
      </div>

      {onOverride && (
        <button
          type="button"
          aria-label="Override slot"
          onClick={(e) => {
            e.stopPropagation();
            onOverride(slot.id);
          }}
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-500 shadow-sm hover:text-slate-900"
        >
          ✎
        </button>
      )}

      {/* Assigned-lice pill, top-left. */}
      {slot.liceName && (
        <span
          title={`Lice: ${slot.liceName}`}
          className="absolute -top-2 -left-2 inline-flex items-center rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 shadow-sm"
        >
          {slot.liceName}
        </span>
      )}
    </div>
  );
}

function FighterRow({
  name,
  club,
  score,
  highlight,
  isCompleted,
  sideColor,
}: {
  name: string | null;
  club: string | null | undefined;
  score: number | null;
  highlight: boolean;
  isCompleted: boolean;
  sideColor: ColorToken;
}) {
  const isTbd = name === null;
  // The row is now tinted with the side colour, so the winner chip
  // escalates to the solid accent + white text — otherwise the tint-on-
  // tint blends together and the winner doesn't read. Non-winner chips
  // get a translucent white pill so they sit cleanly on top of the row
  // tint without forcing a neutral slate background.
  const scoreChipClasses = isTbd
    ? 'bg-white/60 text-slate-300'
    : highlight
      ? `${accentClassFor(sideColor)} text-white font-bold`
      : isCompleted
        ? 'bg-white/70 text-slate-500'
        : 'bg-white/70 text-slate-600';

  // Each row owns its side's visual identity: a 3-px coloured stripe
  // on the left edge + a soft tint across the full row. Both classes
  // come from the same ColorToken (driven by the tournament's
  // scoring_config.display.sideColors) so changing colours in the
  // tournament settings ripples here automatically.
  const rowTintClass = isTbd ? '' : tintBgClassFor(sideColor);
  const stripeClass = isTbd ? 'bg-slate-200' : accentClassFor(sideColor);

  return (
    <div className={`flex h-[26px] flex-1 items-stretch ${rowTintClass}`}>
      <span aria-hidden="true" className={`w-[3px] shrink-0 ${stripeClass}`} />
      <div className="flex flex-1 items-center justify-between gap-1 pl-2 pr-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* Name takes priority for the row width (grows, truncates only as a
              last resort); the club yields first — capped + truncating — so a
              long club name no longer squeezes the fighter's name. */}
          <span
            title={name ?? undefined}
            className={[
              'min-w-0 flex-1 truncate text-xs',
              isTbd
                ? 'text-slate-400'
                : highlight
                  ? 'font-semibold text-slate-900'
                  : isCompleted
                    ? 'text-slate-500'
                    : 'text-slate-700',
            ].join(' ')}
          >
            {name ?? '-'}
          </span>
          {club && !isTbd && (
            <span
              title={club}
              className="min-w-0 max-w-[40%] flex-none truncate rounded bg-white/70 px-1 py-px text-[10px] text-slate-500"
            >
              {club}
            </span>
          )}
        </span>
        <span
          className={[
            'w-9 shrink-0 rounded px-1 text-right font-mono text-xs tabular-nums',
            scoreChipClasses,
          ].join(' ')}
        >
          {score ?? '-'}
        </span>
      </div>
    </div>
  );
}

function winsThisRow(side: 'red' | 'blue', slot: BracketSlotData): boolean {
  if (slot.redScore === null || slot.blueScore === null) return false;
  if (side === 'red') return slot.redScore > slot.blueScore;
  return slot.blueScore > slot.redScore;
}
