import * as React from 'react';

/**
 * BracketView — shared bracket renderer for web-public and web-admin.
 *
 * Framework-agnostic: accepts onMatchClick callback instead of Next.js Link.
 * Renders single_elim (vertical column per round) or double_elim (WB top, LB bottom).
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
  /** 'WB' | 'LB' | 'GF' | 'RESET' — provided for double_elim slots */
  section?: string;
}

export interface BracketConfig {
  phaseType: 'single_elim' | 'double_elim';
  rounds?: number;
  wbRounds?: number;
  lbRounds?: number;
}

export interface BracketViewProps {
  slots: BracketSlotData[];
  rounds: number;
  /** Called when a match slot is clicked. Receives matchId (null if no match yet). */
  onMatchClick?: (matchId: string | null, slotId: string) => void;
  /** Called when the pencil override icon is clicked (admin only). */
  onOverrideSlot?: (slotId: string) => void;
  /** Bracket configuration — drives double_elim layout. */
  bracketConfig?: BracketConfig;
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
  onOverrideSlot,
}: {
  slot: BracketSlotData;
  onMatchClick?: BracketViewProps['onMatchClick'];
  onOverrideSlot?: BracketViewProps['onOverrideSlot'];
}) {
  const borderClass = STATUS_BORDER[slot.status] ?? 'border-gray-800';
  const isLive = slot.status === 'running';

  const handleClick = onMatchClick ? () => onMatchClick(slot.matchId, slot.id) : undefined;

  return (
    <div className="relative group">
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
            <span className="font-bold text-red-400 tabular-nums flex-shrink-0">
              {slot.redScore}
            </span>
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

      {onOverrideSlot && (
        <button
          type="button"
          aria-label="Override slot"
          onClick={(e) => {
            e.stopPropagation();
            onOverrideSlot(slot.id);
          }}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-white p-0.5"
        >
          ✏️
        </button>
      )}
    </div>
  );
}

// ── Single-elim layout ────────────────────────────────────────────────────────

function SingleElimLayout({
  slots,
  rounds,
  onMatchClick,
  onOverrideSlot,
  accentColor,
}: Pick<BracketViewProps, 'slots' | 'rounds' | 'onMatchClick' | 'onOverrideSlot' | 'accentColor'>) {
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
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  onMatchClick={onMatchClick}
                  onOverrideSlot={onOverrideSlot}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Double-elim layout ────────────────────────────────────────────────────────

function DoubleElimLayout({
  slots,
  wbRounds,
  lbRounds,
  onMatchClick,
  onOverrideSlot,
  accentColor,
}: {
  slots: BracketSlotData[];
  wbRounds: number;
  lbRounds: number;
  onMatchClick?: BracketViewProps['onMatchClick'];
  onOverrideSlot?: BracketViewProps['onOverrideSlot'];
  accentColor?: string;
}) {
  const gfRound = wbRounds + lbRounds + 1;

  const wbSlots = slots.filter((s) => s.round <= wbRounds);
  const lbSlots = slots.filter((s) => s.round > wbRounds && s.round <= wbRounds + lbRounds);
  const gfSlots = slots.filter((s) => s.round >= gfRound);

  function buildRoundColumns(
    roundSlots: BracketSlotData[],
    labelFn: (round: number, idx: number, total: number) => string,
    color: string,
  ) {
    const byRound = new Map<number, BracketSlotData[]>();
    for (const slot of roundSlots) {
      const arr = byRound.get(slot.round) ?? [];
      arr.push(slot);
      byRound.set(slot.round, arr);
    }
    const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
    return rounds.map((round, idx) => {
      const rSlots = (byRound.get(round) ?? []).sort((a, b) => a.position - b.position);
      return (
        <div key={round} className="flex flex-col">
          <p
            className="text-xs font-bold uppercase tracking-widest mb-3 text-center"
            style={{ color }}
          >
            {labelFn(round, idx, rounds.length)}
          </p>
          <div
            className="flex flex-col justify-around flex-1 gap-3"
            style={{ minHeight: `${rSlots.length * 80}px` }}
          >
            {rSlots.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                onMatchClick={onMatchClick}
                onOverrideSlot={onOverrideSlot}
              />
            ))}
          </div>
        </div>
      );
    });
  }

  const wbColumns = buildRoundColumns(
    wbSlots,
    (r, idx, total) => {
      const rem = total - idx;
      if (rem === 1) return 'WB Final';
      if (rem === 2) return 'WB Semis';
      return `WB R${r}`;
    },
    accentColor ?? '#f59e0b',
  );

  const lbColumns = buildRoundColumns(lbSlots, (_r, idx) => `LB R${idx + 1}`, '#60a5fa');

  const gfColumns = buildRoundColumns(
    gfSlots,
    (_r, _idx, _total) => {
      const section = _r === gfRound ? 'Grand Final' : 'Reset';
      return section;
    },
    '#a78bfa',
  );

  const maxWbHeight = Math.max(
    ...wbSlots
      .reduce((acc, s) => {
        const cur = acc.get(s.round) ?? 0;
        acc.set(s.round, cur + 1);
        return acc;
      }, new Map<number, number>())
      .values(),
    1,
  );

  const maxLbHeight = Math.max(
    ...lbSlots
      .reduce((acc, s) => {
        const cur = acc.get(s.round) ?? 0;
        acc.set(s.round, cur + 1);
        return acc;
      }, new Map<number, number>())
      .values(),
    1,
  );

  const wbMinH = `${maxWbHeight * 100}px`;
  const lbMinH = `${maxLbHeight * 100}px`;

  return (
    <div className="flex gap-8 min-w-max">
      {/* WB + LB stacked */}
      <div className="flex flex-col gap-6">
        {/* Winners Bracket */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-2 text-amber-500/60">
            Winners Bracket
          </p>
          <div className="flex gap-6" style={{ minHeight: wbMinH }}>
            {wbColumns}
          </div>
        </div>

        {/* Losers Bracket */}
        {lbSlots.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-2 text-blue-400/60">
              Losers Bracket
            </p>
            <div className="flex gap-6" style={{ minHeight: lbMinH }}>
              {lbColumns}
            </div>
          </div>
        )}
      </div>

      {/* Grand Final + Reset */}
      {gfSlots.length > 0 && (
        <div className="flex flex-col gap-6 self-center">
          <p className="text-xs font-bold uppercase tracking-widest mb-2 text-violet-400/60">
            Finals
          </p>
          <div className="flex gap-6">{gfColumns}</div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BracketView({
  slots,
  rounds,
  onMatchClick,
  onOverrideSlot,
  bracketConfig,
  accentColor = '#f59e0b',
}: BracketViewProps) {
  const isDoubleElim = bracketConfig?.phaseType === 'double_elim';
  const wbRounds = bracketConfig?.wbRounds ?? 0;
  const lbRounds = bracketConfig?.lbRounds ?? 0;

  return (
    <div className="overflow-x-auto pb-4">
      {isDoubleElim ? (
        <DoubleElimLayout
          slots={slots}
          wbRounds={wbRounds}
          lbRounds={lbRounds}
          onMatchClick={onMatchClick}
          onOverrideSlot={onOverrideSlot}
          accentColor={accentColor}
        />
      ) : (
        <SingleElimLayout
          slots={slots}
          rounds={rounds}
          onMatchClick={onMatchClick}
          onOverrideSlot={onOverrideSlot}
          accentColor={accentColor}
        />
      )}
      <p className="text-xs text-gray-600 mt-4">
        {rounds}-round bracket · {slots.length} match slots
      </p>
    </div>
  );
}
