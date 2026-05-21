import * as React from 'react';
import { accentClassFor } from '../../utils/color-token';
import type { BracketSlotData, ColorToken } from './types';

export interface MatchCardProps {
  slot: BracketSlotData;
  redColor?: ColorToken;
  blueColor?: ColorToken;
  onClick?: (matchId: string | null, slotId: string) => void;
  onOverride?: (slotId: string) => void;
  /** Registers the card's outer element for connector geometry. */
  registerRef?: (slotId: string, el: HTMLDivElement | null) => void;
}

function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: 'Final', cls: 'bg-emerald-100 text-emerald-700' };
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
}: MatchCardProps) {
  const isTbd =
    (slot.redFighterName === null || slot.blueFighterName === null) && slot.status !== 'completed';
  const isLive = slot.status === 'running';
  const isReadyOrLive = slot.status === 'ready' || slot.status === 'running';
  const isCompleted = slot.status === 'completed';
  const pill = statusPill(slot.status);

  const handleClick = onClick ? () => onClick(slot.matchId, slot.id) : undefined;

  const cardClasses = [
    'group relative flex h-[52px] min-w-[160px] max-w-[180px] items-stretch rounded-md shadow-sm transition-shadow',
    isReadyOrLive ? 'bg-amber-50' : isTbd ? 'bg-slate-50' : 'bg-white',
    isTbd
      ? 'border border-dashed border-slate-300'
      : isReadyOrLive
        ? 'border border-amber-200'
        : 'border border-slate-200',
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
    <div ref={refCallback} className="relative">
      <div
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
        {/* Left stripe (red side) */}
        <span aria-hidden="true" className={`w-[3px] rounded-l-md ${accentClassFor(redColor)}`} />

        {/* Fighter rows */}
        <div className="flex flex-1 flex-col divide-y divide-slate-100">
          <FighterRow
            name={slot.redFighterName}
            club={slot.redClubAbbrev}
            score={slot.redScore}
            highlight={isCompleted && winsThisRow('red', slot)}
            isCompleted={isCompleted}
          />
          <FighterRow
            name={slot.blueFighterName}
            club={slot.blueClubAbbrev}
            score={slot.blueScore}
            highlight={isCompleted && winsThisRow('blue', slot)}
            isCompleted={isCompleted}
          />
        </div>

        {/* Right stripe (blue side) */}
        <span aria-hidden="true" className={`w-[3px] rounded-r-md ${accentClassFor(blueColor)}`} />

        {/* Status pill bottom-right (absolute, outside the row flex) */}
        <span
          className={`absolute -bottom-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.cls}`}
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
          className="absolute -top-2 -right-2 hidden h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-500 shadow-sm hover:text-slate-900 group-hover:flex"
        >
          ✎
        </button>
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
}: {
  name: string | null;
  club: string | null | undefined;
  score: number | null;
  highlight: boolean;
  isCompleted: boolean;
}) {
  const isTbd = name === null;
  return (
    <div className="flex h-[26px] flex-1 items-center justify-between gap-1 pl-2 pr-1">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={[
            'truncate text-xs',
            isTbd
              ? 'italic text-slate-400'
              : highlight
                ? 'font-semibold text-slate-900'
                : 'text-slate-700',
          ].join(' ')}
        >
          {isTbd ? 'TBD' : name}
        </span>
        {club && !isTbd && (
          <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] text-slate-500">
            {club}
          </span>
        )}
      </span>
      <span
        className={[
          'w-[32px] shrink-0 rounded bg-slate-50 px-1 text-right font-mono text-xs tabular-nums',
          isTbd ? 'text-slate-300' : isCompleted ? 'font-bold text-slate-900' : 'text-slate-600',
        ].join(' ')}
      >
        {score === null ? '—' : score}
      </span>
    </div>
  );
}

function winsThisRow(side: 'red' | 'blue', slot: BracketSlotData): boolean {
  if (slot.redScore === null || slot.blueScore === null) return false;
  if (side === 'red') return slot.redScore > slot.blueScore;
  return slot.blueScore > slot.redScore;
}
