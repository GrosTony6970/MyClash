import * as React from 'react';
import { MatchCard } from './bracket/MatchCard';
import { BracketConnectors, type ConnectorEdge } from './bracket/BracketConnectors';
import type { BracketConfig, BracketSlotData, ColorToken, PodiumData } from './bracket/types';

export type { BracketSlotData, BracketConfig, PodiumData };

export interface BracketViewProps {
  slots: BracketSlotData[];
  rounds: number;
  /** Label for round 0 play-in slots. */
  playInLabel?: string;
  /** Called when a match slot is clicked. Receives matchId (null if no match yet). */
  onMatchClick?: (matchId: string | null, slotId: string) => void;
  /** Called when the pencil override icon is clicked (admin only). */
  onOverrideSlot?: (slotId: string) => void;
  /** Bracket configuration — drives double_elim layout. */
  bracketConfig?: BracketConfig;
  /** Side colors driven by the tournament's scoring_config.display.sideColors. */
  redColor?: ColorToken;
  blueColor?: ColorToken;
  /** Optional bronze match slot — rendered below the Final column on single-elim. */
  bronzeMatch?: BracketSlotData | null;
  /** Round-label overrides — by default, last-round = Final, etc. */
  roundLabels?: Record<number, string>;
}

const ROUND_GAP_CLASS = 'gap-16';
const SLOT_VERTICAL_PITCH_PX = 90;

export function BracketView({
  slots,
  rounds,
  playInLabel,
  onMatchClick,
  onOverrideSlot,
  bracketConfig,
  redColor = 'red',
  blueColor = 'blue',
  bronzeMatch,
  roundLabels,
}: BracketViewProps) {
  const isDoubleElim = bracketConfig?.phaseType === 'double_elim';

  if (isDoubleElim) {
    return (
      <DoubleElimLayout
        slots={slots}
        wbRounds={bracketConfig?.wbRounds ?? 0}
        lbRounds={bracketConfig?.lbRounds ?? 0}
        onMatchClick={onMatchClick}
        onOverrideSlot={onOverrideSlot}
        redColor={redColor}
        blueColor={blueColor}
      />
    );
  }

  return (
    <SingleElimLayout
      slots={slots}
      rounds={rounds}
      playInLabel={playInLabel}
      onMatchClick={onMatchClick}
      onOverrideSlot={onOverrideSlot}
      redColor={redColor}
      blueColor={blueColor}
      bronzeMatch={bronzeMatch ?? null}
      roundLabels={roundLabels}
    />
  );
}

// ── Single-elim ────────────────────────────────────────────────────────────

interface SingleElimLayoutProps {
  slots: BracketSlotData[];
  rounds: number;
  playInLabel?: string;
  onMatchClick?: BracketViewProps['onMatchClick'];
  onOverrideSlot?: BracketViewProps['onOverrideSlot'];
  redColor: ColorToken;
  blueColor: ColorToken;
  bronzeMatch: BracketSlotData | null;
  roundLabels?: Record<number, string>;
}

function SingleElimLayout({
  slots,
  rounds,
  playInLabel = 'Play-ins',
  onMatchClick,
  onOverrideSlot,
  redColor,
  blueColor,
  bronzeMatch,
  roundLabels,
}: SingleElimLayoutProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement | null>());

  const registerRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    cardRefs.current.set(id, el);
  }, []);

  const byRound = React.useMemo(() => {
    const m = new Map<number, BracketSlotData[]>();
    for (const slot of slots) {
      const arr = m.get(slot.round) ?? [];
      arr.push(slot);
      m.set(slot.round, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [slots]);

  const roundNumbers = React.useMemo(
    () => Array.from(byRound.keys()).sort((a, b) => a - b),
    [byRound],
  );

  const labels = React.useMemo(() => {
    const out: Record<number, string> = {};
    const main = roundNumbers.filter((r) => r > 0);
    for (let i = 0; i < main.length; i++) {
      const r = main[i]!;
      const remaining = main.length - i;
      if (remaining === 1) out[r] = 'Final';
      else if (remaining === 2) out[r] = 'Semi-finals';
      else if (remaining === 3) out[r] = 'Quarter-finals';
      else out[r] = `Round of ${1 << remaining}`;
    }
    if (roundNumbers.includes(0)) out[0] = playInLabel;
    return { ...out, ...(roundLabels ?? {}) };
  }, [roundNumbers, playInLabel, roundLabels]);

  const edges = React.useMemo<ConnectorEdge[]>(() => {
    const out: ConnectorEdge[] = [];
    for (let i = 0; i < roundNumbers.length - 1; i++) {
      const r = roundNumbers[i]!;
      const next = roundNumbers[i + 1]!;
      const fromSlots = byRound.get(r) ?? [];
      const toSlots = byRound.get(next) ?? [];
      for (const fs of fromSlots) {
        const targetIdx = Math.floor(fs.position / 2);
        const ts = toSlots[targetIdx];
        if (ts) out.push({ from: fs.id, to: ts.id, kind: 'winner' });
      }
    }
    if (bronzeMatch) {
      const mainRounds = roundNumbers.filter((r) => r > 0);
      const sfRound = mainRounds[mainRounds.length - 2];
      if (sfRound !== undefined) {
        const sfSlots = byRound.get(sfRound) ?? [];
        for (const sf of sfSlots) {
          out.push({ from: sf.id, to: bronzeMatch.id, kind: 'bronze' });
        }
      }
    }
    return out;
  }, [byRound, roundNumbers, bronzeMatch]);

  const totalMatches = (byRound.get(roundNumbers[0] ?? 0) ?? []).length;
  const minColumnHeight = Math.max(totalMatches * SLOT_VERTICAL_PITCH_PX, 200);

  return (
    <div className="space-y-8">
      <div className="overflow-x-auto pb-6">
        <div ref={containerRef} className={`relative flex ${ROUND_GAP_CLASS} w-full items-stretch`}>
          <BracketConnectors
            cardRefs={cardRefs.current}
            edges={edges}
            containerRef={containerRef}
          />
          {roundNumbers.map((round) => {
            const isFinalRound = round > 0 && round === roundNumbers[roundNumbers.length - 1];
            const roundSlots = byRound.get(round) ?? [];
            return (
              <div
                key={round}
                className="relative z-10 flex min-w-[180px] max-w-[320px] flex-1 flex-col"
              >
                <p className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
                  {labels[round] ?? `R${round}`}
                </p>
                <div
                  className="flex flex-col justify-around gap-3"
                  style={{ minHeight: `${minColumnHeight}px` }}
                >
                  {roundSlots.map((slot) => (
                    <MatchCard
                      key={slot.id}
                      slot={slot}
                      redColor={redColor}
                      blueColor={blueColor}
                      onClick={onMatchClick}
                      onOverride={onOverrideSlot}
                      registerRef={registerRef}
                      isChampionshipMatch={isFinalRound}
                    />
                  ))}
                  {isFinalRound && bronzeMatch && (
                    <div className="mt-8">
                      <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-amber-700">
                        Bronze Match
                      </p>
                      <MatchCard
                        slot={bronzeMatch}
                        redColor={redColor}
                        blueColor={blueColor}
                        onClick={onMatchClick}
                        onOverride={onOverrideSlot}
                        registerRef={registerRef}
                        isBronzeMatch={true}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {rounds}-round bracket · {slots.length} match slot{slots.length === 1 ? '' : 's'}
        {bronzeMatch ? ' · bronze match' : ''}
      </p>
    </div>
  );
}

// ── Double-elim ────────────────────────────────────────────────────────────

interface DoubleElimLayoutProps {
  slots: BracketSlotData[];
  wbRounds: number;
  lbRounds: number;
  onMatchClick?: BracketViewProps['onMatchClick'];
  onOverrideSlot?: BracketViewProps['onOverrideSlot'];
  redColor: ColorToken;
  blueColor: ColorToken;
}

function DoubleElimLayout({
  slots,
  wbRounds,
  lbRounds,
  onMatchClick,
  onOverrideSlot,
  redColor,
  blueColor,
}: DoubleElimLayoutProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement | null>());

  const registerRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    cardRefs.current.set(id, el);
  }, []);

  const gfRound = wbRounds + lbRounds + 1;

  const wbSlots = slots.filter((s) => s.round <= wbRounds);
  const lbSlots = slots.filter((s) => s.round > wbRounds && s.round <= wbRounds + lbRounds);
  const gfSlots = slots.filter((s) => s.round >= gfRound);

  const edges = React.useMemo<ConnectorEdge[]>(() => {
    const out: ConnectorEdge[] = [];
    function addRoundEdges(roundSlots: BracketSlotData[]): void {
      const byRound = new Map<number, BracketSlotData[]>();
      for (const s of roundSlots) {
        const arr = byRound.get(s.round) ?? [];
        arr.push(s);
        byRound.set(s.round, arr);
      }
      for (const arr of byRound.values()) arr.sort((a, b) => a.position - b.position);
      const rs = Array.from(byRound.keys()).sort((a, b) => a - b);
      for (let i = 0; i < rs.length - 1; i++) {
        const from = byRound.get(rs[i]!) ?? [];
        const to = byRound.get(rs[i + 1]!) ?? [];
        for (const fs of from) {
          const target = to[Math.floor(fs.position / 2)];
          if (target) out.push({ from: fs.id, to: target.id, kind: 'winner' });
        }
      }
    }
    addRoundEdges(wbSlots);
    addRoundEdges(lbSlots);
    return out;
  }, [wbSlots, lbSlots]);

  return (
    <div className="space-y-6 overflow-x-auto pb-6">
      <div ref={containerRef} className="relative w-full space-y-8">
        <BracketConnectors cardRefs={cardRefs.current} edges={edges} containerRef={containerRef} />
        <Lane
          title="Winners Bracket"
          slots={wbSlots}
          renderCard={(slot) => (
            <MatchCard
              key={slot.id}
              slot={slot}
              redColor={redColor}
              blueColor={blueColor}
              onClick={onMatchClick}
              onOverride={onOverrideSlot}
              registerRef={registerRef}
            />
          )}
          accent="text-amber-600"
        />
        {lbSlots.length > 0 && (
          <Lane
            title="Losers Bracket"
            slots={lbSlots}
            renderCard={(slot) => (
              <MatchCard
                key={slot.id}
                slot={slot}
                redColor={redColor}
                blueColor={blueColor}
                onClick={onMatchClick}
                onOverride={onOverrideSlot}
                registerRef={registerRef}
              />
            )}
            accent="text-blue-600"
          />
        )}
        {gfSlots.length > 0 && (
          <Lane
            title="Finals"
            slots={gfSlots}
            renderCard={(slot) => (
              <MatchCard
                key={slot.id}
                slot={slot}
                redColor={redColor}
                blueColor={blueColor}
                onClick={onMatchClick}
                onOverride={onOverrideSlot}
                registerRef={registerRef}
              />
            )}
            accent="text-violet-600"
            roundLabelFn={(round) => (round === gfRound ? 'Grand Final' : 'Reset')}
          />
        )}
      </div>
    </div>
  );
}

function Lane({
  title,
  slots,
  renderCard,
  accent,
  roundLabelFn,
}: {
  title: string;
  slots: BracketSlotData[];
  renderCard: (slot: BracketSlotData) => React.ReactNode;
  accent: string;
  roundLabelFn?: (round: number, idx: number, total: number) => string;
}) {
  const byRound = new Map<number, BracketSlotData[]>();
  for (const s of slots) {
    const arr = byRound.get(s.round) ?? [];
    arr.push(s);
    byRound.set(s.round, arr);
  }
  for (const arr of byRound.values()) arr.sort((a, b) => a.position - b.position);
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  return (
    <section>
      <p className={`mb-3 text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</p>
      <div className="flex w-full gap-16">
        {rounds.map((round, idx) => {
          const rSlots = byRound.get(round) ?? [];
          const label = roundLabelFn ? roundLabelFn(round, idx, rounds.length) : `R${idx + 1}`;
          return (
            <div key={round} className="flex min-w-[180px] max-w-[320px] flex-1 flex-col">
              <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <div
                className="flex flex-col justify-around gap-3"
                style={{ minHeight: `${rSlots.length * SLOT_VERTICAL_PITCH_PX}px` }}
              >
                {rSlots.map(renderCard)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
