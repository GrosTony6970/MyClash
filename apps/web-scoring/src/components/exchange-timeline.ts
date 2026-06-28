/**
 * The unified scoring timeline — ONE numbered list shared by the centre
 * Exchange History and the Corrections drawer, so their `#` numbers always
 * agree. Exchanges (clean / afterblow incl. net-zero 1-1 / double / no-
 * exchange) and penalties (cards) are merged, ordered chronologically, and
 * numbered contiguously 1..N. Cards therefore count as exchanges; a net-zero
 * afterblow stays visible + numbered.
 *
 * `orderedWithNumbers` is pure (no React, no I/O); `buildUnifiedTimeline` adds
 * the row mapping (labels/colours) on top of it.
 */

import type { TournamentScoringConfig } from '@myclash/types';
import { formatMatchClock, sideStyle } from '@myclash/ui';
import { exchangeDeltaLabel, afterblowDefenderLabel } from './exchange-delta-label';
import type { ExchangeRow } from '../hooks/useExchanges';
import type { MatchPenalty, PenaltyCard } from '../hooks/usePenalties';

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
  opponentSideColor?: string | null;
  opponentLabel?: string | null;
  opponentDelta?: string | null;
}

/** A row before its display number is assigned. */
type UnifiedEventDraft = Omit<UnifiedEvent, 'number'>;

/**
 * Assign a contiguous 1..N number across the rows in chronological order
 * (tie-break by stored `seq`), then return them newest-first for display.
 */
export function orderedWithNumbers<T extends { occurredAt: string; seq: number }>(
  rows: T[],
): (T & { number: number })[] {
  const ascending = [...rows].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.seq - b.seq,
  );
  const numbered = ascending.map((r, i) => ({ ...r, number: i + 1 }));
  return numbered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.seq - a.seq);
}

export interface BuildTimelineArgs {
  exchanges: ExchangeRow[];
  penalties: MatchPenalty[];
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
  const exchangeRows: UnifiedEventDraft[] = exchanges.map((e) => {
    const side: 'red' | 'blue' | null = e.scoringSide ?? null;
    const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
    const typeLabel =
      e.type === 'double'
        ? t('scoring.lice.eventRowDouble')
        : e.type === 'no_exchange'
          ? t('scoring.lice.eventRowNoExchange')
          : e.type === 'afterblow'
            ? 'AB'
            : 'clean';
    // Full-afterblow: the defender (the OTHER fighter) also scores, so surface
    // their points alongside the first striker's so the row shows both deltas.
    const opponentDelta = afterblowDefenderLabel(e.type, e.defenderDelta);
    const oppSide: 'red' | 'blue' | null = side === 'red' ? 'blue' : side === 'blue' ? 'red' : null;
    // Scoring rows always show their delta — INCLUDING '+0' for a 1-1
    // afterblow, so a no-point exchange still visibly registers.
    return {
      id: `ex-${e.id}`,
      kind: 'exchange',
      rawId: e.id,
      seq: e.sequence,
      occurredAt: e.occurredAt,
      timeLabel: formatMatchClock(e.clockTimeMs),
      sideColor: side ? sideStyle(config, side).border : null,
      fighterLabel: e.type === 'double' ? t('scoring.lice.eventRowDouble') : sideName,
      typeLabel,
      icon: e.type === 'double' ? '⚔' : null,
      card: null,
      delta: exchangeDeltaLabel(e.type, e.scoreDelta),
      opponentSideColor: opponentDelta && oppSide ? sideStyle(config, oppSide).border : null,
      opponentLabel: opponentDelta
        ? oppSide === 'red'
          ? redName
          : oppSide === 'blue'
            ? blueName
            : null
        : null,
      opponentDelta,
    };
  });

  const penaltyRows: UnifiedEventDraft[] = penalties.map((p) => {
    const side: 'red' | 'blue' | null =
      p.registration_id === redRegId ? 'red' : p.registration_id === blueRegId ? 'blue' : null;
    const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
    return {
      id: `pen-${p.id}`,
      kind: 'penalty',
      rawId: p.id,
      seq: p.sequence,
      occurredAt: p.occurred_at ?? '',
      timeLabel: formatMatchClock(p.clock_time_ms),
      sideColor: side ? sideStyle(config, side).border : null,
      fighterLabel: sideName,
      typeLabel: (p.short_name ?? p.reason ?? '').trim(),
      icon: null,
      card: p.card,
      delta: p.score_delta ? String(p.score_delta) : null,
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
