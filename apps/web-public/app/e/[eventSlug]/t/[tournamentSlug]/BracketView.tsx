'use client';

/**
 * BracketView — T-605
 *
 * Renders a single-elimination bracket for 8/16/32 fighters.
 * Horizontal layout: rounds as columns, slots as rows.
 *
 * AC: Bracket renders correctly for 8/16/32 fighter brackets.
 */

import Link from 'next/link';
import type { BracketSlot } from './page';

interface Props {
  slots: BracketSlot[];
  bracketSize: number;
  rounds: number;
  eventSlug: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'border-gray-700',
  running: 'border-red-600',
  scheduled: 'border-gray-800',
  voided: 'border-gray-900 opacity-40',
};

function SlotCard({ slot, eventSlug }: { slot: BracketSlot; eventSlug: string }) {
  const borderClass = STATUS_COLORS[slot.status] ?? 'border-gray-800';
  const isLive = slot.status === 'running';

  const content = (
    <div
      className={[
        'border rounded-lg p-2 text-xs min-w-[120px]',
        borderClass,
        isLive ? 'bg-red-950/30' : 'bg-gray-900',
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

      {/* Divider */}
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

  if (slot.matchId) {
    return <Link href={`/e/${eventSlug}/match/${slot.matchId}`}>{content}</Link>;
  }
  return content;
}

export function BracketView({ slots, rounds, eventSlug }: Props) {
  // Group slots by round
  const byRound = new Map<number, BracketSlot[]>();
  for (const slot of slots) {
    const arr = byRound.get(slot.round) ?? [];
    arr.push(slot);
    byRound.set(slot.round, arr);
  }

  // Sort rounds ascending, slots by position within each round
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
              {/* Round label */}
              <p
                className="text-xs font-bold uppercase tracking-widest mb-3 text-center"
                style={{ color: 'var(--event-accent, #f59e0b)' }}
              >
                {roundLabels[round] ?? `R${round}`}
              </p>

              {/* Slots — vertically centered within the round */}
              <div
                className="flex flex-col justify-around flex-1 gap-3"
                style={{ minHeight: `${roundSlots.length * 80}px` }}
              >
                {roundSlots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} eventSlug={eventSlug} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Round count info */}
      <p className="text-xs text-gray-600 mt-4">
        {rounds}-round bracket · {slots.length} match slots
      </p>
    </div>
  );
}
