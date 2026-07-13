import * as React from 'react';
import { formatRoundCode } from '@myclash/types';
import { MatchCard } from './bracket/MatchCard';
import { BracketHighlightContext } from './bracket/highlight-context';
import { BracketConnectors, type ConnectorEdge } from './bracket/BracketConnectors';
import { computeBracketEdges } from './bracket/compute-bracket-edges';
import { computeSlotPositions } from './bracket/compute-slot-positions';
import type { BracketConfig, BracketSlotData, ColorToken, PodiumData } from './bracket/types';

export type { BracketSlotData, BracketConfig, PodiumData };

export interface BracketViewProps {
  slots: BracketSlotData[];
  rounds: number;
  /** Label for round 0 play-in slots. */
  playInLabel?: string;
  /**
   * Called when a match slot is clicked. Receives matchId (null when no
   * match exists yet for an empty slot) and liceId (null when the
   * match has no lice assigned). The bracket page uses liceId to
   * build the cross-app URL into the scoring app.
   */
  onMatchClick?: (matchId: string | null, slotId: string, liceId: string | null) => void;
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
  /**
   * Tournament weapon — feeds the per-card round code (e.g. LSW-QF-M1).
   * Omitted → no round code rendered on the cards.
   */
  weapon?: string | null;
  /**
   * Total fighters the bracket started with. Combined with `weapon` to
   * compute the position label (R32 / QF / SF / F).
   */
  bracketSize?: number | null;
  /** Personal space: mark the viewer's own slots (matched by registration id). */
  highlightRegistrationId?: string | null;
  /** i18n'd "YOU" chip label (lib is i18n-free). */
  youLabel?: string;
  /** Render each card's assigned referees below the pill row. Off by default →
   *  admin + public brackets are unchanged until a consumer opts in. */
  showReferees?: boolean;
  /** `${slotId}::${role ?? ''}` keys flagging the viewer's own referee rows. */
  refereeSelfKeys?: ReadonlySet<string>;
  /** Humanises a referee_skills.id role into a label (app-provided). */
  refereeRoleLabel?: (role: string | null) => string;
  /** Tailwind horizontal-gap class between round columns. Defaults to the
   *  compact `gap-16`; consumers (e.g. the public bracket) can pass a wider
   *  value like `gap-24` without affecting other brackets. */
  roundGapClass?: string;
}

const ROUND_GAP_CLASS = 'gap-16';
const SLOT_VERTICAL_PITCH_PX = 90;
// Extra vertical room per referee row + a small band padding, added to the
// pitch when referees are shown so the band never overlaps the next card.
const REF_ROW_PX = 20;
const REF_BAND_PAD_PX = 8;
// The MatchCard renders at roughly this height (header + two
// fighter rows + footer). Used to offset cards from their
// computed vertical center so they read as centred — not as
// top-aligned with the connector endpoint.
const CARD_HEIGHT_PX = 78;

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
  weapon = null,
  bracketSize = null,
  highlightRegistrationId,
  youLabel,
  showReferees = false,
  refereeSelfKeys,
  refereeRoleLabel,
  roundGapClass = ROUND_GAP_CLASS,
}: BracketViewProps) {
  const isDoubleElim = bracketConfig?.phaseType === 'double_elim';

  // Fold-aware vertical pitch. Cards are positioned absolutely at a fixed pitch;
  // an expanded referee band (rendered below each card) would overlap the card
  // beneath it, so widen the pitch by the tallest card's referee-band height.
  // Folded (the public/admin default) ⇒ pitch stays SLOT_VERTICAL_PITCH_PX ⇒
  // zero geometry change.
  const maxRefRows = showReferees
    ? slots.reduce((n, s) => Math.max(n, s.referees?.length ?? 0), 0)
    : 0;
  const pitchPx =
    SLOT_VERTICAL_PITCH_PX + (maxRefRows > 0 ? REF_BAND_PAD_PX + maxRefRows * REF_ROW_PX : 0);

  // Memoised per-slot round-code resolver. `slot.position` is already
  // 1-indexed by the generator (see packages/rulesets/.../single-elim.ts
  // — `position: pos + 1` for round 1, `position: pos` for later rounds
  // where pos starts at 1). The earlier `slot.position + 1` here shifted
  // every label by one (R16-M2…M9 instead of R16-M1…M8); see the
  // regression test at apps/api/src/modules/matches/round-code.helper.test.ts.
  const roundCodeFor = React.useCallback(
    (slot: BracketSlotData): string | undefined => {
      if (!weapon) return undefined;
      return formatRoundCode({
        weapon,
        poolNumber: null,
        bracketRound: slot.round,
        bracketSize,
        matchNumber: slot.position,
      });
    },
    [weapon, bracketSize],
  );

  const layout = isDoubleElim ? (
    <DoubleElimLayout
      slots={slots}
      wbRounds={bracketConfig?.wbRounds ?? 0}
      lbRounds={bracketConfig?.lbRounds ?? 0}
      onMatchClick={onMatchClick}
      onOverrideSlot={onOverrideSlot}
      redColor={redColor}
      blueColor={blueColor}
      roundCodeFor={roundCodeFor}
      pitchPx={pitchPx}
      roundGapClass={roundGapClass}
    />
  ) : (
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
      roundCodeFor={roundCodeFor}
      pitchPx={pitchPx}
      roundGapClass={roundGapClass}
    />
  );

  // Provide the viewer's highlight + referee config to every MatchCard via
  // context (empty by default → public + admin brackets unchanged).
  return (
    <BracketHighlightContext.Provider
      value={{ highlightRegistrationId, youLabel, showReferees, refereeSelfKeys, refereeRoleLabel }}
    >
      {layout}
    </BracketHighlightContext.Provider>
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
  roundCodeFor: (slot: BracketSlotData) => string | undefined;
  pitchPx: number;
  roundGapClass: string;
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
  roundCodeFor,
  pitchPx,
  roundGapClass,
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
      // Last round = the Finals column. The gold/silver vs bronze distinction is
      // shown by the in-column labels ("Gold & Silver Match" / "Bronze Match").
      if (remaining === 1) out[r] = 'Finals';
      else if (remaining === 2) out[r] = 'Semi-finals';
      else if (remaining === 3) out[r] = 'Quarter-finals';
      else out[r] = `Round of ${1 << remaining}`;
    }
    if (roundNumbers.includes(0)) out[0] = playInLabel;
    return { ...out, ...(roundLabels ?? {}) };
  }, [roundNumbers, playInLabel, roundLabels]);

  const edges = React.useMemo<ConnectorEdge[]>(() => {
    const out: ConnectorEdge[] = [
      // Within-lane winner pairing — single source of truth shared
      // with the double-elim layout via computeBracketEdges.
      ...computeBracketEdges(slots, roundNumbers),
    ];
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
  }, [slots, byRound, roundNumbers, bronzeMatch]);

  // Each next-round card sits at the vertical midpoint of its
  // parent pair (operator's mental model). Power-of-2 brackets
  // already produce that effect with flex justify-around, but
  // play-in rounds, bye-padded first rounds, and the losers'
  // lane break uniform distribution. The pure helper resolves
  // every slot's pixel center; cards then render with absolute
  // positioning rather than flex.
  const { positions, columnHeight } = React.useMemo(
    () => computeSlotPositions(byRound, roundNumbers, edges, pitchPx),
    [byRound, roundNumbers, edges, pitchPx],
  );

  return (
    <div className="space-y-8">
      <div className="overflow-x-auto pb-6">
        <div ref={containerRef} className={`relative flex ${roundGapClass} w-full items-stretch`}>
          <BracketConnectors
            cardRefs={cardRefs.current}
            edges={edges}
            containerRef={containerRef}
          />
          {roundNumbers.map((round) => {
            const isFinalRound = round > 0 && round === roundNumbers[roundNumbers.length - 1];
            const roundSlots = byRound.get(round) ?? [];
            // Finals column: the gold/silver decider sits at its computed center
            // (the semifinal-pair midpoint — same rule as every other round) so
            // the SF→Final connectors stay symmetric. The bronze match is pulled
            // out of `slots` (extractBronzeMatch) and has no computed center, so
            // it's placed one pitch below the final; both get a caption above the
            // card. `columnHeight` is widened so the lower bronze isn't clipped.
            const finalCenter = isFinalRound
              ? Math.max(0, ...roundSlots.map((s) => positions.get(s.id) ?? 0))
              : 0;
            const bronzeCenter = finalCenter + pitchPx;
            const colHeight =
              isFinalRound && bronzeMatch
                ? Math.max(columnHeight, bronzeCenter + CARD_HEIGHT_PX)
                : columnHeight;
            return (
              <div
                key={round}
                className="relative z-10 flex min-w-[256px] max-w-[360px] flex-1 flex-col"
              >
                <p className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
                  {labels[round] ?? `R${round}`}
                </p>
                <div className="relative" style={{ height: `${colHeight}px` }}>
                  {roundSlots.map((slot) => {
                    const center = positions.get(slot.id) ?? 0;
                    return (
                      <React.Fragment key={slot.id}>
                        {isFinalRound && (
                          <p
                            className="absolute left-0 right-0 text-center text-[10px] font-semibold uppercase tracking-widest text-amber-700"
                            style={{ top: `${center - CARD_HEIGHT_PX / 2 - 18}px` }}
                          >
                            Gold &amp; Silver Match
                          </p>
                        )}
                        <div
                          className="absolute left-0 right-0"
                          style={{ top: `${center - CARD_HEIGHT_PX / 2}px` }}
                        >
                          <MatchCard
                            slot={slot}
                            redColor={redColor}
                            blueColor={blueColor}
                            onClick={onMatchClick}
                            onOverride={onOverrideSlot}
                            registerRef={registerRef}
                            isChampionshipMatch={isFinalRound}
                            roundCode={roundCodeFor(slot)}
                          />
                        </div>
                      </React.Fragment>
                    );
                  })}
                  {isFinalRound && bronzeMatch && (
                    <>
                      <p
                        className="absolute left-0 right-0 text-center text-[10px] font-semibold uppercase tracking-widest text-amber-700"
                        style={{ top: `${bronzeCenter - CARD_HEIGHT_PX / 2 - 18}px` }}
                      >
                        Bronze Match
                      </p>
                      <div
                        className="absolute left-0 right-0"
                        style={{ top: `${bronzeCenter - CARD_HEIGHT_PX / 2}px` }}
                      >
                        <MatchCard
                          slot={bronzeMatch}
                          redColor={redColor}
                          blueColor={blueColor}
                          onClick={onMatchClick}
                          onOverride={onOverrideSlot}
                          registerRef={registerRef}
                          isBronzeMatch={true}
                          roundCode={roundCodeFor(bronzeMatch)}
                        />
                      </div>
                    </>
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
  roundCodeFor: (slot: BracketSlotData) => string | undefined;
  pitchPx: number;
  roundGapClass: string;
}

function DoubleElimLayout({
  slots,
  wbRounds,
  lbRounds,
  onMatchClick,
  onOverrideSlot,
  redColor,
  blueColor,
  roundCodeFor,
  pitchPx,
  roundGapClass,
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
    // Within-lane edges per bracket. Cross-lane WB→LB drops aren't
    // drawn today (separate feature).
    const wbRoundNumbers = Array.from(new Set(wbSlots.map((s) => s.round))).sort((a, b) => a - b);
    const lbRoundNumbers = Array.from(new Set(lbSlots.map((s) => s.round))).sort((a, b) => a - b);
    return [
      ...computeBracketEdges(wbSlots, wbRoundNumbers),
      ...computeBracketEdges(lbSlots, lbRoundNumbers),
    ];
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
              roundCode={roundCodeFor(slot)}
            />
          )}
          accent="text-amber-600"
          pitchPx={pitchPx}
          roundGapClass={roundGapClass}
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
                roundCode={roundCodeFor(slot)}
              />
            )}
            accent="text-blue-600"
            pitchPx={pitchPx}
            roundGapClass={roundGapClass}
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
                roundCode={roundCodeFor(slot)}
              />
            )}
            accent="text-violet-600"
            roundLabelFn={(round) => (round === gfRound ? 'Grand Final' : 'Reset')}
            pitchPx={pitchPx}
            roundGapClass={roundGapClass}
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
  pitchPx,
  roundGapClass,
}: {
  title: string;
  slots: BracketSlotData[];
  renderCard: (slot: BracketSlotData) => React.ReactNode;
  accent: string;
  roundLabelFn?: (round: number, idx: number, total: number) => string;
  pitchPx: number;
  roundGapClass: string;
}) {
  const byRound = new Map<number, BracketSlotData[]>();
  for (const s of slots) {
    const arr = byRound.get(s.round) ?? [];
    arr.push(s);
    byRound.set(s.round, arr);
  }
  for (const arr of byRound.values()) arr.sort((a, b) => a.position - b.position);
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);

  // Same parent-midpoint placement as SingleElimLayout, applied
  // per lane. Edges are computed inline because the parent
  // DoubleElimLayout already passes per-lane slot subsets in.
  const edges = computeBracketEdges(slots, rounds);
  const { positions, columnHeight } = computeSlotPositions(byRound, rounds, edges, pitchPx);

  return (
    <section>
      <p className={`mb-3 text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</p>
      <div className={`flex w-full ${roundGapClass}`}>
        {rounds.map((round, idx) => {
          const rSlots = byRound.get(round) ?? [];
          const label = roundLabelFn ? roundLabelFn(round, idx, rounds.length) : `R${idx + 1}`;
          return (
            <div key={round} className="flex min-w-[256px] max-w-[360px] flex-1 flex-col">
              <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <div className="relative" style={{ height: `${columnHeight}px` }}>
                {rSlots.map((slot) => {
                  const center = positions.get(slot.id) ?? 0;
                  return (
                    <div
                      key={slot.id}
                      className="absolute left-0 right-0"
                      style={{ top: `${center - CARD_HEIGHT_PX / 2}px` }}
                    >
                      {renderCard(slot)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
