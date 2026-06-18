'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { matchStatusSemantic, statusPillTone } from '@myclash/ui';
import { supabase } from '@/lib/supabase';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

// ── Types ────────────────────────────────────────────────────────────────────

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';
export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';

export interface MatchRow {
  id: string;
  matchNumberLabel: string | null;
  rulesetCode: string;
  redScore: number;
  blueScore: number;
  status: MatchStatus;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ExchangeRow {
  id: string;
  sequence: number;
  type: ExchangeType;
  firstStrikerColor: 'red' | 'blue' | null;
  firstStrikeValue: number | null;
  afterblowValue: number | null;
  noExchangeReason: string | null;
  redScoreDelta: number;
  blueScoreDelta: number;
  voided: boolean;
  voidedReason: string | null;
  occurredAt: string;
}

export interface MatchPenaltyRow {
  id: string;
  sequence: number;
  registration_id: string;
  card: 'yellow' | 'red' | 'black';
  source: 'ruleset' | 'direct';
  short_name: string | null;
  reason: string | null;
  score_delta: number;
  causes_match_forfeit: boolean;
  voided: boolean;
  occurred_at: string;
}

// Supabase Realtime postgres_changes payloads use raw DB column names (snake_case).
interface ExchangeChangeRaw {
  id: string;
  match_id: string;
  sequence: number;
  type: ExchangeType;
  first_striker_color: 'red' | 'blue' | null;
  first_strike_value: number | null;
  afterblow_value: number | null;
  no_exchange_reason: string | null;
  red_score_delta: number;
  blue_score_delta: number;
  voided: boolean;
  voided_reason: string | null;
  occurred_at: string;
}

interface MatchChangeRaw {
  id: string;
  red_score: number;
  blue_score: number;
  status: MatchStatus;
  started_at: string | null;
  ended_at: string | null;
}

interface MatchPenaltyChangeRaw extends MatchPenaltyRow {
  match_id: string;
}

function toExchangeRow(raw: ExchangeChangeRaw): ExchangeRow {
  return {
    id: raw.id,
    sequence: raw.sequence,
    type: raw.type,
    firstStrikerColor: raw.first_striker_color,
    firstStrikeValue: raw.first_strike_value,
    afterblowValue: raw.afterblow_value,
    noExchangeReason: raw.no_exchange_reason,
    redScoreDelta: raw.red_score_delta,
    blueScoreDelta: raw.blue_score_delta,
    voided: raw.voided,
    voidedReason: raw.voided_reason,
    occurredAt: raw.occurred_at,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBoard({ match }: { match: MatchRow }) {
  const { t } = useI18n();
  const statusLabel: Record<MatchStatus, string> = {
    scheduled: t('scoring.liveMatch.status.scheduled'),
    running: t('scoring.liveMatch.status.running'),
    paused: t('scoring.liveMatch.status.paused'),
    completed: t('scoring.liveMatch.status.completed'),
    voided: t('scoring.liveMatch.status.voided'),
  };

  const tone = statusPillTone(matchStatusSemantic(match.status), 'light');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {match.matchNumberLabel && (
        <p className="mb-3 text-center text-xs font-medium tracking-widest text-gray-400 uppercase">
          {match.matchNumberLabel}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        {/* Red side */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-red-600" />
          <span className="text-sm font-medium text-gray-500">{t('scoring.liveMatch.red')}</span>
          <span className="text-6xl font-bold tabular-nums text-red-600">{match.redScore}</span>
        </div>

        {/* Divider */}
        <span className="text-3xl font-light text-gray-300">–</span>

        {/* Blue side */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-blue-600" />
          <span className="text-sm font-medium text-gray-500">{t('scoring.liveMatch.blue')}</span>
          <span className="text-6xl font-bold tabular-nums text-blue-600">{match.blueScore}</span>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tone.className} ${
            tone.pulse ? 'animate-pulse' : ''
          }`}
        >
          {statusLabel[match.status]}
        </span>
      </div>
    </div>
  );
}

function ExchangeLabel({ exchange }: { exchange: ExchangeRow }) {
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

  const color = exchange.firstStrikerColor ?? 'red';
  const value = exchange.firstStrikeValue ?? 1;
  const colorLabel = color === 'red' ? t('scoring.liveMatch.red') : t('scoring.liveMatch.blue');
  const colorClass = color === 'red' ? 'text-red-600' : 'text-blue-600';

  if (exchange.type === 'afterblow') {
    const abValue = exchange.afterblowValue ?? 1;
    const opponentLabel =
      color === 'red' ? t('scoring.liveMatch.blue') : t('scoring.liveMatch.red');
    const opponentClass = color === 'red' ? 'text-blue-600' : 'text-red-600';
    return (
      <span>
        <span className={`font-medium ${colorClass}`}>{colorLabel}</span>
        {` ${value}pt`}
        {` + ${t('scoring.liveMatch.afterblow')} `}
        <span className={`font-medium ${opponentClass}`}>{opponentLabel}</span>
        {` ${abValue}pt`}
      </span>
    );
  }

  // clean hit
  return (
    <span>
      <span className={`font-medium ${colorClass}`}>{colorLabel}</span>
      {` ${t('scoring.liveMatch.hit')} - ${value}pt`}
    </span>
  );
}

function ExchangeFeed({ exchanges }: { exchanges: ExchangeRow[] }) {
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
            className="flex items-baseline justify-between rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm shadow-xs"
          >
            <span className="mr-3 text-xs tabular-nums text-gray-400">#{ex.sequence}</span>
            <span className="flex-1">
              <ExchangeLabel exchange={ex} />
            </span>
            <span className="ml-3 tabular-nums text-xs text-gray-400">
              {new Date(ex.occurredAt).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
            </span>
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

function PenaltyFeed({ penalties }: { penalties: MatchPenaltyRow[] }) {
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

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
        {t('scoring.liveMatch.cards')}
      </h2>
      <ol className="space-y-2">
        {active.map((penalty) => (
          <li
            key={penalty.id}
            className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm shadow-xs"
          >
            <span>
              <span
                className={`mr-2 rounded border px-2 py-0.5 text-xs font-black uppercase ${cardClass[penalty.card]}`}
              >
                {penalty.card}
              </span>
              {penalty.short_name ?? penalty.reason ?? t('scoring.liveMatch.directCard')}
            </span>
            <span className="text-xs text-gray-400">
              {penalty.score_delta !== 0 ? penalty.score_delta : ''}
              {penalty.causes_match_forfeit ? ` ${t('scoring.liveMatch.matchLost')}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Main client component ────────────────────────────────────────────────────

interface Props {
  matchId: string;
  initialMatch: MatchRow;
  initialExchanges: ExchangeRow[];
  initialPenalties: MatchPenaltyRow[];
  apiUrl: string;
}

export function MatchLiveView({
  matchId,
  initialMatch,
  initialExchanges,
  initialPenalties,
  apiUrl,
}: Props) {
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchRow>(initialMatch);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>(initialExchanges);
  const [penalties, setPenalties] = useState<MatchPenaltyRow[]>(initialPenalties);
  const [connected, setConnected] = useState(true);
  const wasDisconnected = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [matchRes, exRes, penaltyRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, { credentials: 'include' }),
      ]);
      if (matchRes.ok) setMatch((await matchRes.json()) as MatchRow);
      if (exRes.ok) setExchanges((await exRes.json()) as ExchangeRow[]);
      if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as MatchPenaltyRow[]);
    } catch {
      // network failure — stay with current state
    }
  }, [matchId, apiUrl]);

  useEffect(() => {
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
          const raw = payload.new as MatchChangeRaw;
          setMatch((prev) => ({
            ...prev,
            redScore: raw.red_score,
            blueScore: raw.blue_score,
            status: raw.status,
            startedAt: raw.started_at,
            endedAt: raw.ended_at,
          }));
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
  }, [matchId, refresh]);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Connection indicator */}
      {!connected && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-yellow-50 px-4 py-2 text-sm text-yellow-700">
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          {t('scoring.liveMatch.reconnecting')}
        </div>
      )}

      <ScoreBoard match={match} />
      <PenaltyFeed penalties={penalties} />
      <ExchangeFeed exchanges={exchanges} />
    </div>
  );
}
