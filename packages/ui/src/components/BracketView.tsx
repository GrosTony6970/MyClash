import * as React from 'react';

/**
 * BracketView — shared bracket renderer for web-public and web-admin.
 *
 * Framework-agnostic: accepts onMatchClick callback instead of Next.js Link.
 * Renders a single-elimination bracket for 8/16/32 fighters.
 */

export interface BracketSlotData {
  id: string;
  round: number;
  position: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number | null;
  blueScore: number | null;
  status: string;
  matchId: string | null;
}

export interface BracketViewProps {
  slots: BracketSlotData[];
  rounds: number;
  /** Called when a match slot is clicked. Receives matchId (null if no match yet). */
  onMatchClick?: (matchId: string | null, slotId: string) => void;
  /** Accent color for round labels. Default: #f59e0b */
  accentColor?: string;
}

const STATUS_BORDER: Record<string, string> = {
  completed: 'border-gray-700',
  running: 'border-red-600',
  scheduled: 'border-gray-800',
  voided: 'border-gray-900 opacity-40',
};

function SlotCard({
  slot,
  onMatchClick,
}: {
  slot: BracketSlotData;
  onMatchClick?: BracketViewProps['onMatchClick'];
}) {
  const borderClass = STATUS_BORDER[slot.status] ?? 'border-gray-800';
  const isLive = slot.status === 'running';

  const handleClick = onMatchClick ? () => onMatchClick(slot.matchId, slot.id) : undefined;

  return (
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
      className={[
        'border rounded-lg p-2 text-xs min-w-[120px]',
        borderClass,
        isLive ? 'bg-red-950/30' : 'bg-gray-900',
        handleClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : '',
      ].join(' ')}
    >
      {isLive && (
        <span className="flex items-center gap-1 text-red-400 font-bold mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          LIVE
        </span>
      )}

      {/* Red fighter */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className={[
            'truncate max-w-[80px]',
            slot.redFighterName ? 'text-white' : 'text-gray-600',
          ].join(' ')}
        >
          {slot.redFighterName ?? 'TBD'}
        </span>
        {slot.redScore !== null && (
          <span className="font-bold text-red-400 tabular-nums flex-shrink-0">{slot.redScore}</span>
        )}
      </div>

      <div className="border-t border-gray-800 my-1" />

      {/* Blue fighter */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={[
            'truncate max-w-[80px]',
            slot.blueFighterName ? 'text-white' : 'text-gray-600',
          ].join(' ')}
        >
          {slot.blueFighterName ?? 'TBD'}
        </span>
        {slot.blueScore !== null && (
          <span className="font-bold text-blue-400 tabular-nums flex-shrink-0">
            {slot.blueScore}
          </span>
        )}
      </div>
    </div>
  );
}

export function BracketView({
  slots,
  rounds,
  onMatchClick,
  accentColor = '#f59e0b',
}: BracketViewProps) {
  const byRound = new Map<number, BracketSlotData[]>();
  for (const slot of slots) {
    const arr = byRound.get(slot.round) ?? [];
    arr.push(slot);
    byRound.set(slot.round, arr);
  }

  const roundNumbers = Array.from(byRound.keys()).sort((a, b) => a - b);

  const roundLabels: Record<number, string> = {};
  for (let i = 0; i < roundNumbers.length; i++) {
    const r = roundNumbers[i]!;
    const remaining = roundNumbers.length - i;
    if (remaining === 1) roundLabels[r] = 'Final';
    else if (remaining === 2) roundLabels[r] = 'Semi-finals';
    else if (remaining === 3) roundLabels[r] = 'Quarter-finals';
    else roundLabels[r] = `Round ${r}`;
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-6 min-w-max">
        {roundNumbers.map((round) => {
          const roundSlots = (byRound.get(round) ?? []).sort((a, b) => a.position - b.position);

          return (
            <div key={round} className="flex flex-col">
              <p
                className="text-xs font-bold uppercase tracking-widest mb-3 text-center"
                style={{ color: accentColor }}
              >
                {roundLabels[round] ?? `R${round}`}
              </p>
              <div
                className="flex flex-col justify-around flex-1 gap-3"
                style={{ minHeight: `${roundSlots.length * 80}px` }}
              >
                {roundSlots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} onMatchClick={onMatchClick} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-600 mt-4">
        {rounds}-round bracket · {slots.length} match slots
      </p>
    </div>
  );
}
