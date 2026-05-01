'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

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
  const statusLabel: Record<MatchStatus, string> = {
    scheduled: 'Scheduled',
    running: 'Live',
    paused: 'Halted',
    completed: 'Completed',
    voided: 'Voided',
  };

  const statusColor: Record<MatchStatus, string> = {
    scheduled: 'bg-gray-100 text-gray-600',
    running: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-blue-100 text-blue-700',
    voided: 'bg-gray-100 text-gray-400',
  };

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
          <span className="text-sm font-medium text-gray-500">Red</span>
          <span className="text-6xl font-bold tabular-nums text-red-600">{match.redScore}</span>
        </div>

        {/* Divider */}
        <span className="text-3xl font-light text-gray-300">–</span>

        {/* Blue side */}
        <div className="flex flex-1 flex-col items-center gap-1">
          <div className="h-3 w-3 rounded-full bg-blue-600" />
          <span className="text-sm font-medium text-gray-500">Blue</span>
          <span className="text-6xl font-bold tabular-nums text-blue-600">{match.blueScore}</span>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColor[match.status]}`}
        >
          {statusLabel[match.status]}
        </span>
      </div>
    </div>
  );
}

function ExchangeLabel({ exchange }: { exchange: ExchangeRow }) {
  if (exchange.type === 'no_exchange') {
    return (
      <span className="text-gray-400">
        No exchange{exchange.noExchangeReason ? ` — ${exchange.noExchangeReason}` : ''}
      </span>
    );
  }

  if (exchange.type === 'double') {
    return <span className="font-medium text-orange-600">Double touch</span>;
  }

  const color = exchange.firstStrikerColor ?? 'red';
  const value = exchange.firstStrikeValue ?? 1;
  const colorLabel = color === 'red' ? 'Red' : 'Blue';
  const colorClass = color === 'red' ? 'text-red-600' : 'text-blue-600';

  if (exchange.type === 'afterblow') {
    const abValue = exchange.afterblowValue ?? 1;
    const opponentLabel = color === 'red' ? 'Blue' : 'Red';
    const opponentClass = color === 'red' ? 'text-blue-600' : 'text-red-600';
    return (
      <span>
        <span className={`font-medium ${colorClass}`}>{colorLabel}</span>
        {` ${value}pt`}
        {' + afterblow '}
        <span className={`font-medium ${opponentClass}`}>{opponentLabel}</span>
        {` ${abValue}pt`}
      </span>
    );
  }

  // clean hit
  return (
    <span>
      <span className={`font-medium ${colorClass}`}>{colorLabel}</span>
      {` hit — ${value}pt`}
    </span>
  );
}

function ExchangeFeed({ exchanges }: { exchanges: ExchangeRow[] }) {
  const active = [...exchanges].reverse().filter((e) => !e.voided);
  const voided = exchanges.filter((e) => e.voided);

  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
        Exchanges
      </h2>

      {active.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">No exchanges yet.</p>
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
              {new Date(ex.occurredAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </li>
        ))}
      </ol>

      {voided.length > 0 && (
        <p className="mt-3 text-center text-xs text-gray-400">
          {voided.length} voided exchange{voided.length > 1 ? 's' : ''} hidden
        </p>
      )}
    </div>
  );
}

// ── Main client component ────────────────────────────────────────────────────

interface Props {
  matchId: string;
  initialMatch: MatchRow;
  initialExchanges: ExchangeRow[];
  apiUrl: string;
}

export function MatchLiveView({ matchId, initialMatch, initialExchanges, apiUrl }: Props) {
  const [match, setMatch] = useState<MatchRow>(initialMatch);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>(initialExchanges);
  const [connected, setConnected] = useState(true);
  const wasDisconnected = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [matchRes, exRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
      ]);
      if (matchRes.ok) setMatch((await matchRes.json()) as MatchRow);
      if (exRes.ok) setExchanges((await exRes.json()) as ExchangeRow[]);
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
          Reconnecting…
        </div>
      )}

      <ScoreBoard match={match} />
      <ExchangeFeed exchanges={exchanges} />
    </div>
  );
}
