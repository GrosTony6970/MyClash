/**
 * The unified scoring timeline — ONE numbered list shared by the referee pad's
 * centre Exchange History, the Corrections drawer, the TV / external display
 * and the public match page, so their `#` numbers always agree. Exchanges
 * (clean / afterblow incl. net-zero 1-1 / double / no-exchange) and penalties
 * (cards) are merged, ordered chronologically, and numbered contiguously 1..N.
 * Cards therefore count as exchanges; a net-zero afterblow stays visible +
 * numbered.
 *
 * Voided rows are filtered HERE, not by callers: numbering them would desync
 * the `#`s between surfaces, which is the one invariant this module exists to
 * guarantee.
 *
 * `orderedWithNumbers` is pure (no React, no I/O); `buildUnifiedTimeline` adds
 * the row mapping (labels/colours) on top of it.
 */

import type { TournamentScoringConfig } from '@myclash/types';
import { formatMatchClock } from './format-match-clock';
import { sideStyle } from './side-color';
import { exchangeDeltaLabel, afterblowDefenderLabel } from './exchange-delta-label';
import type { ExchangeRow, Penalty, PenaltyCard } from '../types/match-events';

export interface UnifiedEvent {
  /** Stable React key (`ex-<id>` / `pen-<id>`). */
  id: string;
  /** Which table the row came from — the drawer only selects exchanges. */
  kind: 'exchange' | 'penalty';
  /** Underlying exchange/penalty id (what the drawer voids/edits). */
  rawId: string;
  /** Stored sequence — tie-break only; NOT the displayed number. */
  seq: number;
  /** Contiguous 1..N display number, assigned across the whole timeline. */
  number: number;
  occurredAt: string;
  timeLabel: string;
  /** Side the row belongs to. Surfaces that paint sides from design tokens
   *  (rather than the operator's configured colours) key off this. */
  side: 'red' | 'blue' | null;
  sideColor: string | null;
  fighterLabel: string;
  typeLabel: string;
  /** Decorative glyph for special rows (⚔ for a double). Null otherwise. */
  icon?: string | null;
  /** Penalty card colour — null for exchange rows. */
  card: PenaltyCard | null;
  delta: string | null;
  /**
   * The OTHER fighter's points on a full-afterblow exchange (defender also
   * scores). Set only for afterblows that awarded the defender points; the
   * row then shows both fighters' deltas. Undefined/null on every other row.
   */
  opponentSide?: 'red' | 'blue' | null;
  opponentSideColor?: string | null;
  opponentLabel?: string | null;
  opponentDelta?: string | null;
  /** Free-text detail: the operator's `no_exchange` reason. Null otherwise. */
  note?: string | null;
  /** True when this card ended the match (the carded fighter forfeits). */
  forfeit?: boolean;
  /**
   * The row is queued on the tablet and has not reached the server yet.
   *
   * Set only by a surface that merges its own offline outbox into the list —
   * the referee pad. Nothing server-side ever sets it, and no other surface
   * should: a spectator display marking a row "pending" would be describing the
   * referee's connection, not the bout.
   */
  pending?: boolean;
}

/** A row before its display number is assigned. */
type UnifiedEventDraft = Omit<UnifiedEvent, 'number'>;

/**
 * The reasons a referee can give for a no-exchange, in the order the pad
 * offers them — `other` last, as the fallback.
 *
 * ONE owner for the id → label mapping, deliberately. These ids are written to
 * `exchanges.no_exchange_reason` by the scoring pad's picker and read back here
 * to label a recorded row, so a second table would let the writer and the
 * reader drift.
 */
export const NO_EXCHANGE_REASONS = [
  'out_of_bounds',
  'simultaneous_stop',
  'no_valid_hit',
  'other',
] as const;

export type NoExchangeReasonId = (typeof NO_EXCHANGE_REASONS)[number];

/**
 * `exchanges.no_exchange_reason` stores the raw id the pad submitted, not a
 * label — rendering it as-is would put `out_of_bounds` on a projector. Map the
 * known ids back to their labels; anything else is free text from an older
 * client and passes through unchanged.
 */
export const NO_EXCHANGE_REASON_KEYS: Record<NoExchangeReasonId, string> = {
  out_of_bounds: 'scoring.pad.noExchangeReasons.outOfBounds',
  simultaneous_stop: 'scoring.pad.noExchangeReasons.simultaneousStop',
  no_valid_hit: 'scoring.pad.noExchangeReasons.noValidHit',
  other: 'scoring.pad.noExchangeReasons.other',
};

function noExchangeNote(
  raw: string | null | undefined,
  t: (k: string, p?: Record<string, string>) => string,
): string | null {
  if (!raw) return null;
  const key = NO_EXCHANGE_REASON_KEYS[raw as NoExchangeReasonId];
  return key ? t(key) : raw;
}

/**
 * Parse a row timestamp to a sortable instant.
 *
 * MUST NOT be a string comparison. The same column reaches a client in two
 * different renderings: PostgREST emits ISO-8601 (`2027-06-21T10:31:00.4+00:00`)
 * while Supabase realtime passes `timestamptz` through untouched as raw Postgres
 * wire text (`2027-06-21 10:31:00.4+00`) — it normalises `timestamp` but
 * deliberately not `timestamptz`. Lexically, `' ' < 'T'`, so every live-inserted
 * row would sort ahead of every fetched one and be numbered #1. Comparing
 * parsed instants makes the numbering independent of the rendering (and also
 * fixes whole-second values, where `'+'` sorts after `'.'`).
 *
 * Unparseable / missing timestamps sort LAST rather than first, so a malformed
 * legacy row degrades quietly instead of stealing `#1`.
 */
function instant(occurredAt: string): number {
  const ms = Date.parse(occurredAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Assign a contiguous 1..N number across the rows in chronological order
 * (tie-break by stored `seq`), returned OLDEST-first.
 *
 * This is where the `#N` on every surface is decided. `orderedWithNumbers`
 * below is just this reversed for display, and the bout-flow chart accumulates
 * over this order directly — so the chart's x-axis and the timeline's `#`
 * cannot drift apart, which is the invariant this module exists to hold.
 */
export function ascendingWithNumbers<T extends { occurredAt: string; seq: number }>(
  rows: T[],
): (T & { number: number })[] {
  const ascending = [...rows].sort(
    (a, b) => instant(a.occurredAt) - instant(b.occurredAt) || a.seq - b.seq,
  );
  return ascending.map((r, i) => ({ ...r, number: i + 1 }));
}

/**
 * Assign a contiguous 1..N number across the rows in chronological order
 * (tie-break by stored `seq`), then return them newest-first for display.
 */
export function orderedWithNumbers<T extends { occurredAt: string; seq: number }>(
  rows: T[],
): (T & { number: number })[] {
  return ascendingWithNumbers(rows).reverse();
}

export interface BuildTimelineArgs {
  exchanges: ExchangeRow[];
  penalties: Penalty[];
  redName: string;
  blueName: string;
  redRegId: string;
  blueRegId: string;
  t: (k: string, p?: Record<string, string>) => string;
  config: TournamentScoringConfig;
}

export function buildUnifiedTimeline({
  exchanges,
  penalties,
  redName,
  blueName,
  redRegId,
  blueRegId,
  t,
  config,
}: BuildTimelineArgs): UnifiedEvent[] {
  const exchangeRows: UnifiedEventDraft[] = exchanges
    .filter((e) => !e.voided)
    .map((e) => {
      const side: 'red' | 'blue' | null = e.scoringSide ?? null;
      const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
      const typeLabel =
        e.type === 'double'
          ? t('scoring.lice.eventRowDouble')
          : e.type === 'no_exchange'
            ? t('scoring.lice.eventRowNoExchange')
            : e.type === 'afterblow'
              ? // Referee shorthand, identical in every locale we ship — kept
                // as a literal so the row stays narrow on a 380px TV column.
                'AB'
              : t('scoring.lice.eventRowClean');
      // Full-afterblow: the defender (the OTHER fighter) also scores, so surface
      // their points alongside the first striker's so the row shows both deltas.
      const opponentDelta = afterblowDefenderLabel(e.type, e.defenderDelta);
      const oppSide: 'red' | 'blue' | null =
        side === 'red' ? 'blue' : side === 'blue' ? 'red' : null;
      // Scoring rows always show their delta — INCLUDING '+0' for a 1-1
      // afterblow, so a no-point exchange still visibly registers.
      return {
        id: `ex-${e.id}`,
        kind: 'exchange',
        rawId: e.id,
        seq: e.sequence,
        occurredAt: e.occurredAt,
        timeLabel: formatMatchClock(e.clockTimeMs),
        side,
        sideColor: side ? sideStyle(config, side).border : null,
        // A double has no scorer to name, and repeating the type in the name
        // slot ("Double ⚔ Double") burns width the 380px TV column can't spare.
        fighterLabel: e.type === 'double' ? '' : sideName,
        typeLabel,
        icon: e.type === 'double' ? '⚔' : null,
        card: null,
        delta: exchangeDeltaLabel(e.type, e.scoreDelta),
        opponentSide: opponentDelta ? oppSide : null,
        opponentSideColor: opponentDelta && oppSide ? sideStyle(config, oppSide).border : null,
        opponentLabel: opponentDelta
          ? oppSide === 'red'
            ? redName
            : oppSide === 'blue'
              ? blueName
              : null
          : null,
        opponentDelta,
        note: e.type === 'no_exchange' ? noExchangeNote(e.no_exchange_reason, t) : null,
        pending: e.pending ?? false,
      };
    });

  const penaltyRows: UnifiedEventDraft[] = penalties
    .filter((p) => !p.voided)
    .map((p) => {
      const side: 'red' | 'blue' | null =
        p.registration_id === redRegId ? 'red' : p.registration_id === blueRegId ? 'blue' : null;
      const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
      // A direct card carries no ruleset entry, so it has neither short_name
      // nor reason — name it rather than rendering a blank cell.
      const typeLabel =
        (p.short_name ?? p.reason ?? '').trim() || t('scoring.liveMatch.directCard');
      return {
        id: `pen-${p.id}`,
        kind: 'penalty',
        rawId: p.id,
        seq: p.sequence,
        occurredAt: p.occurred_at ?? '',
        timeLabel: formatMatchClock(p.clock_time_ms),
        side,
        sideColor: side ? sideStyle(config, side).border : null,
        fighterLabel: sideName,
        typeLabel,
        icon: null,
        card: p.card,
        delta: p.score_delta ? String(p.score_delta) : null,
        forfeit: p.causes_match_forfeit,
        pending: p.pending ?? false,
      };
    });

  return orderedWithNumbers([...exchangeRows, ...penaltyRows]);
}

/**
 * One-line label for a Corrections-drawer `<option>` — the shared display
 * number plus the exchange info (time · fighter · type · delta).
 */
export function exchangeOptionLabel(
  ev: Pick<UnifiedEvent, 'number' | 'timeLabel' | 'fighterLabel' | 'typeLabel' | 'delta'>,
): string {
  const base = [`#${ev.number}`, ev.timeLabel, ev.fighterLabel, ev.typeLabel]
    .filter((part) => part !== '')
    .join(' · ');
  return ev.delta ? `${base} ${ev.delta}` : base;
}
