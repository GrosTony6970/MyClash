'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMatchClock } from '@myclash/ui';
import { formatInZone } from '@myclash/time';
import { supabase } from '@/lib/supabase';
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
  return {
    id: raw.id,
    sequence: raw.sequence,
    type: raw.type,
    voided: raw.voided,
    noExchangeReason: raw.no_exchange_reason,
    scoringSide,
    scoreDelta,
    defenderDelta: raw.afterblow_value,
    clockTimeMs: raw.clock_time_ms,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBoard({ match, summary }: { match: MatchRow; summary: MatchSummary }) {
  const { t } = useI18n();
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
    const base = side === 'red' ? 'text-red-600' : 'text-blue-600';
    if (!winner) return base;
    return winner === side ? `${base} font-black` : `${base} opacity-40`;
  };

  const fmtTime = (iso: string | null) =>
    formatInZone(iso, summary.eventTimezone, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {label && (
        <p className="mb-3 text-center text-xs font-medium tracking-widest text-gray-400 uppercase">
          {label}
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* Red side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span className={`text-6xl font-bold tabular-nums ${scoreClass('red')}`}>
            {match.redScore}
          </span>
          <span className="text-sm font-semibold text-gray-800">
            {summary.redName || t('scoring.liveMatch.red')}
          </span>
          {summary.redClub && <span className="text-xs text-gray-500">{summary.redClub}</span>}
        </div>

        {/* Divider */}
        <span className="mt-8 text-3xl font-light text-gray-300">–</span>

        {/* Blue side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span className={`text-6xl font-bold tabular-nums ${scoreClass('blue')}`}>
            {match.blueScore}
          </span>
          <span className="text-sm font-semibold text-gray-800">
            {summary.blueName || t('scoring.liveMatch.blue')}
          </span>
          {summary.blueClub && <span className="text-xs text-gray-500">{summary.blueClub}</span>}
        </div>
      </div>

      {/* Meta: winner, start/end, referee, status */}
      <div className="mt-5 flex flex-col items-center gap-1 border-t border-gray-100 pt-4 text-center">
        {winnerName && <p className="text-lg font-black text-gray-900">🏆 {winnerName}</p>}
        {(match.startedAt || match.endedAt) && (
          <p className="text-xs text-gray-500">
            {match.startedAt && `${t('scoring.liveMatch.started')} ${fmtTime(match.startedAt)}`}
            {match.startedAt && match.endedAt && ' · '}
            {match.endedAt && `${t('scoring.liveMatch.ended')} ${fmtTime(match.endedAt)}`}
          </p>
        )}
        {summary.referees.length > 0 && (
          <p className="text-xs text-gray-500">
            {t('scoring.liveMatch.referee')}: {summary.referees.join(', ')}
          </p>
        )}
        <span className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {statusLabel[match.status]}
        </span>
      </div>
    </div>
  );
}

function ExchangeLabel({
  exchange,
  redName,
  blueName,
}: {
  exchange: ExchangeRow;
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  if (exchange.type === 'no_exchange') {
    return (
      <span className="text-gray-400">
        {t('scoring.liveMatch.noExchange')}
        {exchange.noExchangeReason ? ` - ${exchange.noExchangeReason}` : ''}
      </span>
    );
  }

  if (exchange.type === 'double') {
    return (
      <span className="font-medium text-orange-600">{t('scoring.liveMatch.doubleTouch')}</span>
    );
  }

  const side = exchange.scoringSide ?? 'red';
  const value = exchange.scoreDelta ?? 0;
  const name = side === 'red' ? redName : blueName;
  const nameClass = side === 'red' ? 'text-red-600' : 'text-blue-600';

  if (exchange.type === 'afterblow') {
    const abValue = exchange.defenderDelta ?? 0;
    const oppName = side === 'red' ? blueName : redName;
    const oppClass = side === 'red' ? 'text-blue-600' : 'text-red-600';
    return (
      <span>
        <span className={`font-medium ${nameClass}`}>{name}</span>
        {` ${value}pt`}
        {` + ${t('scoring.liveMatch.afterblow')} `}
        <span className={`font-medium ${oppClass}`}>{oppName}</span>
        {` ${abValue}pt`}
      </span>
    );
  }

  // clean hit
  return (
    <span>
      <span className={`font-medium ${nameClass}`}>{name}</span>
      {` ${t('scoring.liveMatch.hit')} - ${value}pt`}
    </span>
  );
}

function ExchangeFeed({
  exchanges,
  redName,
  blueName,
}: {
  exchanges: ExchangeRow[];
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  const active = [...exchanges].reverse().filter((e) => !e.voided);
  const voided = exchanges.filter((e) => e.voided);

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
        {t('scoring.liveMatch.exchanges')}
      </h2>

      {active.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">
          {t('scoring.liveMatch.noExchanges')}
        </p>
      )}

      <ol className="space-y-2">
        {active.map((ex) => (
          <li
            key={ex.id}
            className="rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm shadow-xs"
          >
            <div className="flex items-baseline gap-2">
              <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-gray-400">
                #{ex.sequence}
              </span>
              <span className="flex-1">
                <ExchangeLabel exchange={ex} redName={redName} blueName={blueName} />
              </span>
            </div>
            <p className="ml-8 mt-0.5 text-xs tabular-nums text-gray-400">
              {formatMatchClock(ex.clockTimeMs)}
            </p>
          </li>
        ))}
      </ol>

      {voided.length > 0 && (
        <p className="mt-3 text-center text-xs text-gray-400">
          {t('scoring.liveMatch.voidedHidden', {
            count: voided.length,
            plural: voided.length > 1 ? 's' : '',
          })}
        </p>
      )}
    </div>
  );
}

function PenaltyFeed({
  penalties,
  match,
  redName,
  blueName,
}: {
  penalties: MatchPenaltyRow[];
  match: MatchRow;
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  const active = penalties
    .filter((penalty) => !penalty.voided)
    .slice()
    .reverse();
  if (active.length === 0) return null;

  const cardClass: Record<MatchPenaltyRow['card'], string> = {
    yellow: 'border-yellow-400 bg-yellow-50 text-yellow-800',
    red: 'border-red-400 bg-red-50 text-red-800',
    black: 'border-gray-900 bg-gray-900 text-white',
  };

  const cardLabel: Record<MatchPenaltyRow['card'], string> = {
    yellow: t('scoring.penalties.cards.yellow'),
    red: t('scoring.penalties.cards.red'),
    black: t('scoring.penalties.cards.black'),
  };

  const fighterFor = (registrationId: string): { name: string; className: string } | null => {
    if (registrationId === match.redRegistrationId)
      return { name: redName, className: 'text-red-600' };
    if (registrationId === match.blueRegistrationId)
      return { name: blueName, className: 'text-blue-600' };
    return null;
  };

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
        {t('scoring.liveMatch.cards')}
      </h2>
      <ol className="space-y-2">
        {active.map((penalty) => {
          const fighter = fighterFor(penalty.registration_id);
          return (
            <li
              key={penalty.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm shadow-xs"
            >
              <span className="flex-1">
                <span
                  className={`mr-2 rounded border px-2 py-0.5 text-xs font-black uppercase ${cardClass[penalty.card]}`}
                >
                  {cardLabel[penalty.card]}
                </span>
                {fighter && (
                  <span className={`font-semibold ${fighter.className}`}>{fighter.name} · </span>
                )}
                {penalty.short_name ?? penalty.reason ?? t('scoring.liveMatch.directCard')}
              </span>
              <span className="ml-2 shrink-0 tabular-nums text-xs text-gray-400">
                {penalty.causes_match_forfeit ? `${t('scoring.liveMatch.matchLost')} · ` : ''}
                {formatMatchClock(penalty.clock_time_ms)}
              </span>
            </li>
          );
        })}
      </ol>
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
  apiUrl: string;
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
  apiUrl,
  backHref,
  backToMatchList,
}: Props) {
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchRow>(initialMatch);
  const [summary, setSummary] = useState<MatchSummary>(initialSummary);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>(initialExchanges);
  const [penalties, setPenalties] = useState<MatchPenaltyRow[]>(initialPenalties);
  const [connected, setConnected] = useState(true);
  const wasDisconnected = useRef(false);

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
  }, [matchId, refresh, isFinal]);

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

      {/* Connection indicator — only for a live match that lost its channel. */}
      {showReconnecting(connected, match.status) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-700">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          {t('scoring.liveMatch.reconnecting')}
        </div>
      )}

      <ScoreBoard match={match} summary={summary} />
      <PenaltyFeed
        penalties={penalties}
        match={match}
        redName={summary.redName || t('scoring.liveMatch.red')}
        blueName={summary.blueName || t('scoring.liveMatch.blue')}
      />
      <ExchangeFeed
        exchanges={exchanges}
        redName={summary.redName || t('scoring.liveMatch.red')}
        blueName={summary.blueName || t('scoring.liveMatch.blue')}
      />
    </div>
  );
}
