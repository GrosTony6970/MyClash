'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildUnifiedTimeline, MatchTimeline } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { supabase } from '@/lib/supabase';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeDisabled } from '@/lib/supabase-browser';
import { BackLink } from '@/components/BackLink';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { showReconnecting } from './show-reconnecting';
import { resolveMatchWinner } from './resolve-match-winner';
import {
  mapMatchRow,
  type ExchangeRow,
  type ExchangeType,
  type MatchPenaltyRow,
  type MatchRow,
  type MatchStatus,
  type MatchSummary,
} from './match-row';

// ── Types ────────────────────────────────────────────────────────────────────

// Supabase Realtime postgres_changes payloads use raw DB column names (snake_case).
interface ExchangeChangeRaw {
  id: string;
  match_id: string;
  sequence: number;
  type: ExchangeType;
  first_striker_color: 'red' | 'blue' | null;
  afterblow_value: number | null;
  no_exchange_reason: string | null;
  red_score_delta: number;
  blue_score_delta: number;
  clock_time_ms: number | null;
  occurred_at: string;
  voided: boolean;
}

interface MatchPenaltyChangeRaw extends MatchPenaltyRow {
  match_id: string;
}

// Derive the API's exchange aliases from a raw realtime row, so realtime and
// server-fetched rows share one shape.
function toExchangeRow(raw: ExchangeChangeRaw): ExchangeRow {
  const scoringSide =
    raw.type === 'clean' || raw.type === 'afterblow' ? raw.first_striker_color : null;
  const scoreDelta =
    scoringSide === 'red'
      ? raw.red_score_delta
      : scoringSide === 'blue'
        ? raw.blue_score_delta
        : null;
  // Defender's NETTED afterblow points (the opposite side's delta) — 0 in
  // deductive mode, the raw afterblow in full. Mirrors the API's listExchanges.
  const defenderDelta =
    raw.type === 'afterblow'
      ? scoringSide === 'red'
        ? raw.blue_score_delta
        : scoringSide === 'blue'
          ? raw.red_score_delta
          : null
      : null;
  return {
    id: raw.id,
    sequence: raw.sequence,
    type: raw.type,
    voided: raw.voided,
    // REQUIRED by the shared timeline: `orderedWithNumbers` sorts on it, so a
    // live-inserted row missing it would sort to the front of the ascending
    // pass and get numbered #1 until the next refresh repaired it.
    occurredAt: raw.occurred_at,
    no_exchange_reason: raw.no_exchange_reason,
    scoringSide,
    scoreDelta,
    defenderDelta,
    clockTimeMs: raw.clock_time_ms,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBoard({ match, summary }: { match: MatchRow; summary: MatchSummary }) {
  const { t, locale } = useI18n();
  const statusLabel: Record<MatchStatus, string> = {
    scheduled: t('scoring.liveMatch.status.scheduled'),
    running: t('scoring.liveMatch.status.running'),
    paused: t('scoring.liveMatch.status.paused'),
    completed: t('scoring.liveMatch.status.completed'),
    voided: t('scoring.liveMatch.status.voided'),
  };

  const winner = resolveMatchWinner({
    status: match.status,
    winnerRegistrationId: match.winnerRegistrationId,
    redRegistrationId: match.redRegistrationId,
    blueRegistrationId: match.blueRegistrationId,
    redScore: match.redScore,
    blueScore: match.blueScore,
  });
  const winnerName = winner === 'red' ? summary.redName : winner === 'blue' ? summary.blueName : '';
  const label = match.matchNumberLabel || summary.roundCode;

  // Score emphasis: when there's a winner, dim the loser; otherwise both full.
  const scoreClass = (side: 'red' | 'blue') => {
    const base = side === 'red' ? 'text-corner-red' : 'text-corner-blue';
    if (!winner) return base;
    return winner === side ? `${base} font-black` : `${base} opacity-40`;
  };

  const fmtTime = (iso: string | null) =>
    formatInZone(
      iso,
      summary.eventTimezone,
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
      localeToBcp47(locale),
    );

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      {label && (
        <p className="mb-3 text-center text-xs font-medium tracking-widest text-muted uppercase">
          {label}
        </p>
      )}

      {summary.bestOf > 1 && (
        <p className="mb-3 text-center text-xs font-bold tracking-wide text-info">
          {t('scoring.rounds.counter', {
            current: String(match.currentRound),
            total: String(summary.bestOf),
          })}
          {' · '}
          {t('scoring.rounds.seriesTally')}{' '}
          <span className="text-corner-red">{match.redRoundWins}</span>
          <span className="text-muted">–</span>
          <span className="text-corner-blue">{match.blueRoundWins}</span>
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* Red side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span className={`text-6xl font-bold tabular-nums ${scoreClass('red')}`}>
            {match.redScore}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {summary.redName || t('scoring.liveMatch.red')}
          </span>
          {summary.redClub && <span className="text-xs text-muted">{summary.redClub}</span>}
        </div>

        {/* Divider */}
        <span className="mt-8 text-3xl font-light text-muted">–</span>

        {/* Blue side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span className={`text-6xl font-bold tabular-nums ${scoreClass('blue')}`}>
            {match.blueScore}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {summary.blueName || t('scoring.liveMatch.blue')}
          </span>
          {summary.blueClub && <span className="text-xs text-muted">{summary.blueClub}</span>}
        </div>
      </div>

      {/* Meta: winner, start/end, referee, status */}
      <div className="mt-5 flex flex-col items-center gap-1 border-t border-border pt-4 text-center">
        {summary.bestOf > 1 && match.awaitingRoundAdvance && (
          <p className="text-sm font-bold text-info">
            {t('scoring.rounds.roundComplete', { round: String(match.currentRound) })}
          </p>
        )}
        {winnerName && <p className="text-lg font-black text-foreground">🏆 {winnerName}</p>}
        {(match.startedAt || match.endedAt) && (
          <p className="text-xs text-muted">
            {match.startedAt && `${t('scoring.liveMatch.started')} ${fmtTime(match.startedAt)}`}
            {match.startedAt && match.endedAt && ' · '}
            {match.endedAt && `${t('scoring.liveMatch.ended')} ${fmtTime(match.endedAt)}`}
          </p>
        )}
        {summary.referees.length > 0 && (
          <p className="text-xs text-muted">
            {t('scoring.liveMatch.referee')}: {summary.referees.join(', ')}
          </p>
        )}
        <span className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {statusLabel[match.status]}
        </span>
      </div>
    </div>
  );
}

function MatchEventFeed({
  exchanges,
  penalties,
  match,
  redName,
  blueName,
}: {
  exchanges: ExchangeRow[];
  penalties: MatchPenaltyRow[];
  match: MatchRow;
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  // The same builder the referee pad and the TV display use, so a spectator's
  // "#6" is the operator's "#6": exchanges and cards in ONE contiguous 1..N
  // sequence, newest first. Voided rows are dropped by the builder; they are
  // still counted below so the page keeps disclosing that they existed.
  const events = useMemo(
    () =>
      buildUnifiedTimeline({
        exchanges,
        penalties,
        redName,
        blueName,
        redRegId: match.redRegistrationId,
        blueRegId: match.blueRegistrationId,
        t,
        // This page never loads a tournament scoring config, so the builder's
        // per-side hex would be meaningless here. `sideColors="tokens"` below
        // ignores it and paints from the corner-red/corner-blue design tokens
        // this page already uses, keeping the surface fully tokenized.
        config: DEFAULT_SCORING_CONFIG,
      }),
    [exchanges, penalties, redName, blueName, match.redRegistrationId, match.blueRegistrationId, t],
  );

  // Exchange-scoped ON PURPOSE: the string says "voided exchanges", so folding
  // voided cards into the same number would misreport them as exchanges.
  const voidedExchanges = exchanges.filter((e) => e.voided).length;
  const header = t('scoring.lice.eventsHeader');

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{header}</h2>

      <MatchTimeline
        events={events}
        scale="page"
        sideColors="tokens"
        emptyLabel={t('scoring.liveMatch.noExchanges')}
        ariaLabel={header}
        t={t}
      />

      {voidedExchanges > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          {t('scoring.liveMatch.voidedHidden', {
            count: String(voidedExchanges),
            plural: voidedExchanges > 1 ? 's' : '',
          })}
        </p>
      )}
    </div>
  );
}

// ── Main client component ────────────────────────────────────────────────────

interface Props {
  matchId: string;
  initialMatch: MatchRow;
  initialSummary: MatchSummary;
  initialExchanges: ExchangeRow[];
  initialPenalties: MatchPenaltyRow[];
  /** Where the top back-link leads (validated root-relative path). */
  backHref: string;
  /** True when `backHref` returns to the pool-matches list (vs. event home). */
  backToMatchList: boolean;
}

export function MatchLiveView({
  matchId,
  initialMatch,
  initialSummary,
  initialExchanges,
  initialPenalties,
  backHref,
  backToMatchList,
}: Props) {
  // Resolved here, not handed down from the server page: a server-resolved URL
  // is the docker-internal host, which the browser can't reach — the polling
  // fallback and post-reconnect catch-up refresh both run in the browser.
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchRow>(initialMatch);
  const [summary, setSummary] = useState<MatchSummary>(initialSummary);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>(initialExchanges);
  const [penalties, setPenalties] = useState<MatchPenaltyRow[]>(initialPenalties);
  const [connected, setConnected] = useState(true);
  const wasDisconnected = useRef(false);
  // disable_realtime kill-switch — when on, the effect below degrades to polling.
  const realtimeDisabled = useRealtimeDisabled();

  // A finished match is static — no realtime channel needed.
  const isFinal = initialMatch.status === 'completed' || initialMatch.status === 'voided';

  const refresh = useCallback(async () => {
    try {
      const [matchRes, summaryRes, exRes, penaltyRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, { credentials: 'include' }),
      ]);
      if (matchRes.ok) setMatch(mapMatchRow((await matchRes.json()) as Record<string, unknown>));
      if (summaryRes.ok) setSummary((await summaryRes.json()) as MatchSummary);
      if (exRes.ok) setExchanges((await exRes.json()) as ExchangeRow[]);
      if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as MatchPenaltyRow[]);
    } catch {
      // network failure — stay with current state
    }
  }, [matchId, apiUrl]);

  useEffect(() => {
    // Finished matches don't stream — skip the channel entirely (no banner).
    if (isFinal) return;

    // disable_realtime kill-switch: no websocket at all; degrade to a 30s
    // refresh poll. The reconnecting banner is derived from the flag at
    // render time (connected && !realtimeDisabled) — no setState needed here.
    if (realtimeDisabled) {
      const timer = window.setInterval(() => void refresh(), 30_000);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() kicks off the poll fetch; intentional on flag flip.
      void refresh();
      return () => window.clearInterval(timer);
    }

    const channel = supabase
      .channel(`match:${matchId}:live`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const raw = payload.new as ExchangeChangeRaw;
          setExchanges((prev) => {
            if (prev.some((e) => e.id === raw.id)) return prev;
            return [...prev, toExchangeRow(raw)];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const raw = payload.new as ExchangeChangeRaw;
          setExchanges((prev) => prev.map((e) => (e.id === raw.id ? toExchangeRow(raw) : e)));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const raw = payload.new as MatchPenaltyChangeRaw;
          setPenalties((prev) => {
            if (prev.some((penalty) => penalty.id === raw.id)) return prev;
            return [...prev, raw];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const raw = payload.new as MatchPenaltyChangeRaw;
          setPenalties((prev) => prev.map((penalty) => (penalty.id === raw.id ? raw : penalty)));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          setMatch(mapMatchRow(payload.new as Record<string, unknown>));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          // Re-fetch to catch any changes missed during the disconnection window.
          if (wasDisconnected.current) {
            wasDisconnected.current = false;
            void refresh();
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnected(false);
          wasDisconnected.current = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, refresh, isFinal, realtimeDisabled]);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <BackLink
        href={backHref}
        label={
          backToMatchList
            ? t('scoring.lice.backToMatchList')
            : t('publicApp.tournament.backToEventHome')
        }
        className="mb-4"
      />

      {/* Connection indicator — live match without a healthy channel (WS
          dropped, or realtime disabled by the kill-switch → 30s polling). */}
      {showReconnecting(connected && !realtimeDisabled, match.status) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-warning/10 px-4 py-2 text-sm text-warning">
          <span className="h-2 w-2 rounded-full bg-warning" />
          {t('scoring.liveMatch.reconnecting')}
        </div>
      )}

      <ScoreBoard match={match} summary={summary} />
      <MatchEventFeed
        exchanges={exchanges}
        penalties={penalties}
        match={match}
        redName={summary.redName || t('scoring.liveMatch.red')}
        blueName={summary.blueName || t('scoring.liveMatch.blue')}
      />
    </div>
  );
}
