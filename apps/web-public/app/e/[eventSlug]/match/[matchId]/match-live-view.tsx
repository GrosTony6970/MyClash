'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  BoutFlowChart,
  MatchTimeline,
  buildBoutFlow,
  sideColorsFor,
  buildUnifiedTimeline,
} from '@myclash/ui';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeDisabled } from '@/lib/supabase-browser';
import { BackLink } from '@/components/BackLink';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { showReconnecting } from './show-reconnecting';
import { resolveMatchWinner } from './resolve-match-winner';
import { useMatchLiveChannel } from './use-match-live-channel';
import {
  mapMatchRow,
  type ExchangeRow,
  type MatchPenaltyRow,
  type MatchRow,
  type MatchStatus,
  type MatchSummary,
} from './match-row';

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBoard({ match, summary }: { match: MatchRow; summary: MatchSummary }) {
  const { t, locale } = useI18n();
  // The organiser's configured side colours, not a generic red/blue: a
  // tournament run white-vs-black must read white-vs-black here too, exactly as
  // it already does on the pad and the projector. `legibleOn` keeps the white
  // and black tokens from vanishing into this light page.
  const colors = sideColorsFor(summary.scoringConfig, 'light');
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
    if (!winner) return '';
    return winner === side ? 'font-black' : 'opacity-40';
  };
  const scoreStyle = (side: 'red' | 'blue') => ({
    color: side === 'red' ? colors.red : colors.blue,
  });

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
          <span style={scoreStyle('red')}>{match.redRoundWins}</span>
          <span className="text-muted">–</span>
          <span style={scoreStyle('blue')}>{match.blueRoundWins}</span>
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* Red side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span
            className={`text-6xl font-bold tabular-nums ${scoreClass('red')}`}
            style={scoreStyle('red')}
          >
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
          <span
            className={`text-6xl font-bold tabular-nums ${scoreClass('blue')}`}
            style={scoreStyle('blue')}
          >
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
  summary,
  redName,
  blueName,
}: {
  exchanges: ExchangeRow[];
  penalties: MatchPenaltyRow[];
  match: MatchRow;
  summary: MatchSummary;
  redName: string;
  blueName: string;
}) {
  const { t } = useI18n();
  const [highlight, setHighlight] = useState<number | null>(null);
  // The tournament's own config now reaches this page (via /summary), so the
  // timeline paints the operator's side colours like every other surface.
  const config = summary.scoringConfig ?? DEFAULT_SCORING_CONFIG;

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
        config,
      }),
    [
      exchanges,
      penalties,
      redName,
      blueName,
      match.redRegistrationId,
      match.blueRegistrationId,
      config,
      t,
    ],
  );

  // The same rows read as momentum. No pause markers: they need the clock
  // endpoint, which this page does not fetch (and which is not yet @Public).
  const flow = useMemo(
    () =>
      buildBoutFlow({
        exchanges,
        penalties,
        redRegId: match.redRegistrationId,
        blueRegId: match.blueRegistrationId,
        matchFormat: summary.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG,
        endReason: match.endReason,
        bestOf: summary.bestOf,
        currentRound: match.currentRound,
      }),
    [exchanges, penalties, match, summary],
  );

  // Exchange-scoped ON PURPOSE: the string says "voided exchanges", so folding
  // voided cards into the same number would misreport them as exchanges.
  const voidedExchanges = exchanges.filter((e) => e.voided).length;
  const header = t('scoring.lice.eventsHeader');

  return (
    <div className="mt-4">
      <BoutFlowChart
        series={flow}
        config={config}
        redName={redName}
        blueName={blueName}
        surface="light"
        scale="page"
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
        t={t}
        className="mb-4"
      />

      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{header}</h2>

      <MatchTimeline
        events={events}
        scale="page"
        emptyLabel={t('scoring.liveMatch.noExchanges')}
        ariaLabel={header}
        highlightNumber={highlight}
        onHighlightChange={setHighlight}
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
  // disable_realtime kill-switch — when on, the channel hook degrades to polling.
  const realtimeDisabled = useRealtimeDisabled();

  // A finished match is static — no realtime channel needed.
  const isFinal = initialMatch.status === 'completed' || initialMatch.status === 'voided';

  /**
   * Volatile state only. `/summary` is deliberately absent: fighter names,
   * clubs, referees, `scoringConfig`, `bestOf` and `matchFormat` do not change
   * mid-bout, and leaving it out takes the fallback poll from four requests to
   * three — see FALLBACK_POLL_MS for why that margin matters at a venue, where
   * every phone shares one public IP.
   */
  const refreshLive = useCallback(async () => {
    try {
      const [matchRes, exRes, penaltyRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, { credentials: 'include' }),
      ]);
      if (matchRes.ok) setMatch(mapMatchRow((await matchRes.json()) as Record<string, unknown>));
      if (exRes.ok) setExchanges((await exRes.json()) as ExchangeRow[]);
      if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as MatchPenaltyRow[]);
    } catch {
      // network failure — stay with current state
    }
  }, [matchId, apiUrl]);

  /** Everything, summary included — the reconnect backfill, where a referee or
   *  config change made during the outage also has to land. */
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshLive(),
      (async () => {
        try {
          const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, {
            credentials: 'include',
          });
          if (res.ok) setSummary((await res.json()) as MatchSummary);
        } catch {
          // network failure — stay with current state
        }
      })(),
    ]);
  }, [refreshLive, matchId, apiUrl]);

  const connected = useMatchLiveChannel({
    matchId,
    isFinal,
    // Live status, not the initial one — a bout that starts while the page is
    // open must speed the fallback up without a reload.
    matchStatus: match.status,
    realtimeDisabled,
    refresh,
    refreshLive,
    setMatch,
    setExchanges,
    setPenalties,
  });

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
          dropped, or realtime disabled by the kill-switch). Either way the
          fallback poll is now carrying the page, so this reports "updates are
          slower", not "updates have stopped" — which is why it stays up while
          the poll runs rather than being suppressed by it. */}
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
        summary={summary}
        redName={summary.redName || t('scoring.liveMatch.red')}
        blueName={summary.blueName || t('scoring.liveMatch.blue')}
      />
    </div>
  );
}
