'use client';

/**
 * TVScoreboard — read-only three-column scoreboard for the public
 * TV / projector display.
 *
 * Mirrors the redesigned referee scoreboard from
 * `apps/web-scoring/src/components/MatchView.tsx` but strips every
 * interactive control (no scoring buttons, no penalty picker, no
 * clock controls, no drawer, no spacebar). Typography is scaled up
 * significantly so the score is legible from across a sports hall.
 *
 * Auto-rollover: 5 seconds after the clock transitions to `'ended'`,
 * navigates to `/e/{eventSlug}/match/{nextMatchId}/display` so the
 * projection self-services between bouts. Re-opening the match from
 * admin cancels the rollover. No next match → stays on the endcard.
 *
 * Used only by `apps/web-public/.../display/page.tsx`. The admin
 * preview surface keeps using `<MatchScoreboard>` (the older
 * single-column layout).
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator, getMessages } from '@myclash/i18n';
import { useLiveMatch, type DisplayMatch, type Penalty } from '../hooks/useLiveMatch';
import { sideStyle, legibleOn } from '../utils/side-color';
import { nextDisplayHref } from './next-display-href';

export interface TVScoreboardProps {
  matchId: string;
  apiBaseUrl: string;
  supabaseClient: SupabaseClient;
  /** Used to build the next-match navigation URL on auto-rollover. */
  eventSlug: string;
  /** Seconds the endcard stays visible before navigating to the
   *  next match. Defaults to 5 per operator request. */
  rolloverDelaySeconds?: number;
  /** Override the rollover destination. Defaults to the web-public
   *  `/e/{eventSlug}/match/{id}/display` route; the admin same-origin
   *  popup passes `(id) => `/display/${id}`` so rollover stays in its
   *  own routing. */
  buildNextDisplayHref?: (nextMatchId: string) => string;
  /**
   * Fallback poll interval (ms) for surfaces whose realtime WebSocket may
   * not connect (e.g. the cross-origin admin external display under
   * `--dev-certs`). Omit to rely on realtime alone (same-origin public
   * display).
   */
  pollMs?: number;
  /**
   * Swap the red/blue fighter columns (and the header name order) so the
   * display reads correctly on a TV facing the audience — the operator's
   * left becomes the spectator's right. Default false; the external
   * display defaults it on.
   */
  mirror?: boolean;
  className?: string;
}

const CARD_COLORS = ['yellow', 'red', 'black'] as const;
const CARD_CHIP_BG: Record<(typeof CARD_COLORS)[number], string> = {
  yellow: 'bg-yellow-400 text-yellow-950',
  red: 'bg-red-600 text-white',
  black: 'bg-gray-900 text-white border border-gray-600',
};

export function TVScoreboard({
  matchId,
  apiBaseUrl,
  supabaseClient,
  eventSlug,
  rolloverDelaySeconds = 5,
  buildNextDisplayHref,
  pollMs,
  mirror = false,
  className,
}: TVScoreboardProps): React.ReactElement | null {
  const t = createTranslator(getMessages());
  const { match, penalties, clock, elapsedMs, loadError, connected } = useLiveMatch(
    apiBaseUrl,
    matchId,
    supabaseClient,
    pollMs,
  );

  // ── Auto-rollover state machine ────────────────────────────────
  // When the clock transitions INTO 'ended', start a countdown.
  // When it transitions OUT of 'ended' (e.g., organizer re-opens),
  // cancel the countdown. When it reaches 0 and we have a next
  // match, hard-navigate to its display URL.
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const clockStatus = clock?.status ?? 'idle';
  const nextMatchId = match?.nextMatchId ?? null;

  useEffect(() => {
    if (clockStatus !== 'ended') {
      setCountdownRemaining(null);
      return;
    }
    // No next match → stay on endcard, no countdown.
    if (!nextMatchId) {
      setCountdownRemaining(null);
      return;
    }
    setCountdownRemaining(rolloverDelaySeconds);
    const interval = setInterval(() => {
      setCountdownRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          // Hard navigation — guarantees fresh server-rendered
          // initial data for the next match, no stale React tree.
          window.location.href = nextDisplayHref(eventSlug, nextMatchId, buildNextDisplayHref);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [clockStatus, nextMatchId, eventSlug, rolloverDelaySeconds, buildNextDisplayHref]);

  // Connection-cue debounce. A realtime-only surface (no pollMs) starts
  // disconnected and only flips connected once the channel acks SUBSCRIBED — a
  // separate handshake that lands after the initial HTTP fetch. Wait a grace
  // period before alarming so a normal first connect (or a brief blip) doesn't
  // flash "Reconnecting"; if the socket is still down after it, the warning is
  // real — dropped mid-bout, OR a never-connecting socket that would otherwise
  // go silently stale (the very gap this cue exists to close).
  const [staleConnection, setStaleConnection] = useState(false);
  useEffect(() => {
    if (pollMs || connected) {
      setStaleConnection(false);
      return;
    }
    const id = setTimeout(() => setStaleConnection(true), 4000);
    return () => clearTimeout(id);
  }, [pollMs, connected]);

  if (loadError) {
    return (
      <div
        className={`flex min-h-screen items-center justify-center bg-gray-950 p-8 text-white ${className ?? ''}`}
      >
        <div className="text-center">
          <p className="text-3xl font-bold">
            {t('organizer.scoreboard.loadError', { status: String(loadError.status) })}
          </p>
          {loadError.message && <p className="mt-3 text-xl text-gray-400">{loadError.message}</p>}
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div
        className={`flex min-h-screen items-center justify-center bg-gray-950 p-8 text-white ${className ?? ''}`}
      >
        <div className="flex items-center gap-4 text-2xl text-gray-400">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          <span>{t('organizer.scoreboard.loading')}</span>
        </div>
      </div>
    );
  }

  const redName = match.redFighterName ?? t('scoring.lice.red');
  const blueName = match.blueFighterName ?? t('scoring.lice.blue');
  const redStyle = sideStyle(match.scoringConfig, 'red');
  const blueStyle = sideStyle(match.scoringConfig, 'blue');

  // Connection cue — surfaces realtime channel health so the board no longer
  // goes stale silently. A `pollMs` surface stays fresh via its poll even when
  // the socket drops (a poll failure surfaces as the full-screen loadError), so
  // it never shows "reconnecting"; finished matches are static so neither chip
  // shows.
  const isFinalMatch = match.status === 'completed' || match.status === 'voided';
  // `staleConnection` already implies a realtime-only surface (!pollMs) whose
  // channel has been down past the grace window — so this only alarms on a
  // genuine outage, never on the normal initial handshake.
  const reconnecting = staleConnection && !isFinalMatch;
  const isLiveBout = match.status === 'running' || match.status === 'paused';
  const connectionCue = reconnecting ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-700">
      <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
      {t('scoring.liveMatch.reconnecting')}
    </span>
  ) : isLiveBout ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-green-700">
      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      {t('scoring.liveMatch.live')}
    </span>
  ) : null;

  const redColumn = (
    <FighterColumn
      key="red"
      name={redName}
      club={match.redClub ?? null}
      score={match.redScore}
      registrationId={match.redRegistrationId ?? null}
      penalties={penalties}
      tintHex={redStyle.border}
    />
  );
  const blueColumn = (
    <FighterColumn
      key="blue"
      name={blueName}
      club={match.blueClub ?? null}
      score={match.blueScore}
      registrationId={match.blueRegistrationId ?? null}
      penalties={penalties}
      tintHex={blueStyle.border}
    />
  );
  // Mirror swaps the whole fighter panel (score + name + club + cards)
  // left↔right so the display reads right on a TV facing the audience.
  const [leftColumn, rightColumn] = mirror ? [blueColumn, redColumn] : [redColumn, blueColumn];

  return (
    <div className={`flex min-h-screen flex-col bg-gray-950 text-white ${className ?? ''}`}>
      <TVHeader
        match={match}
        redName={redName}
        blueName={blueName}
        redBorder={redStyle.border}
        blueBorder={blueStyle.border}
        mirror={mirror}
        connectionCue={connectionCue}
      />

      <div className="grid flex-1 grid-cols-[1fr_minmax(380px,28%)_1fr] gap-6 px-6 py-4">
        {leftColumn}
        <CenterColumn
          match={match}
          clockStatus={clockStatus}
          elapsedMs={elapsedMs}
          penalties={penalties}
          countdownRemaining={countdownRemaining}
          redName={redName}
          blueName={blueName}
          t={t}
        />
        {rightColumn}
      </div>

      <TVFooter match={match} t={t} />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────

function TVHeader({
  match,
  redName,
  blueName,
  redBorder,
  blueBorder,
  mirror = false,
  connectionCue,
}: {
  match: DisplayMatch;
  redName: string;
  blueName: string;
  redBorder: string;
  blueBorder: string;
  mirror?: boolean;
  connectionCue?: React.ReactNode;
}) {
  const matchCode = match.roundCode ?? match.matchNumberLabel ?? '';
  const eventName = match.event?.name ?? null;
  const liceName = match.lice?.name ?? null;
  const next = match.nextMatch ?? null;
  // The header strip + NEXT tile are light surfaces — clamp the side
  // colours so a white-configured side stays legible (no white-on-white).
  const redOnLight = legibleOn(redBorder, 'light');
  const blueOnLight = legibleOn(blueBorder, 'light');
  // Mirror swaps the "X vs Y" name order to match the swapped body columns.
  const leftName = mirror ? blueName : redName;
  const leftColor = mirror ? blueOnLight : redOnLight;
  const rightName = mirror ? redName : blueName;
  const rightColor = mirror ? redOnLight : blueOnLight;

  return (
    <header className="border-b border-slate-700 bg-white px-6 py-4 text-slate-900">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <div className="flex flex-col items-start gap-1 text-left text-sm font-semibold text-slate-600">
          {eventName && <p>◇ {eventName}</p>}
          {liceName && <p className="text-xs text-slate-500">{liceName}</p>}
          {connectionCue}
        </div>
        <div className="flex flex-col items-center gap-1">
          {matchCode && (
            <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-4 py-1 font-mono text-xl font-bold tracking-widest text-amber-700">
              {matchCode}
            </span>
          )}
          {(match.bestOf ?? 1) > 1 && (
            <span className="rounded-full border-2 border-sky-300 bg-sky-50 px-4 py-1 text-base font-bold tabular-nums text-sky-700">
              Round {match.currentRound ?? 1}/{match.bestOf}
              {' · '}
              <span style={{ color: redOnLight }}>{match.redRoundWins ?? 0}</span>
              <span className="mx-0.5 text-slate-400">–</span>
              <span style={{ color: blueOnLight }}>{match.blueRoundWins ?? 0}</span>
              {match.awaitingRoundAdvance ? ' · ⏸' : ''}
            </span>
          )}
          <p className="text-2xl font-bold">
            <span style={{ color: leftColor }}>{leftName}</span>{' '}
            <span className="text-slate-500">vs</span>{' '}
            <span style={{ color: rightColor }}>{rightName}</span>
          </p>
        </div>
        <div className="flex justify-end">
          {next && (
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-right">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">NEXT ▸</p>
              <p className="text-sm font-semibold">
                <span style={{ color: redOnLight }}>●</span> {next.redFighterName ?? '—'}
              </p>
              <p className="text-sm font-semibold">
                <span style={{ color: blueOnLight }}>●</span> {next.blueFighterName ?? '—'}
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Fighter columns ───────────────────────────────────────────────

function FighterColumn({
  name,
  club,
  score,
  registrationId,
  penalties,
  tintHex,
}: {
  name: string;
  club: { name: string; logoUrl: string | null } | null;
  score: number;
  registrationId: string | null;
  penalties: Penalty[];
  tintHex: string;
}) {
  const myPenalties = penalties.filter((p) => !p.voided && p.registration_id === registrationId);
  return (
    <div className="flex flex-col items-center justify-start gap-6 pt-6">
      <p
        className="text-[24rem] font-black leading-none tabular-nums"
        style={{ color: legibleOn(tintHex, 'dark') }}
      >
        {score}
      </p>
      <p className="text-center text-5xl font-bold leading-tight">{name}</p>
      {club && (
        <div className="flex items-center justify-center gap-3 text-2xl text-gray-300">
          {club.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={club.logoUrl}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full border border-white/20 bg-white/5 object-contain"
            />
          )}
          <span>{club.name}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        {CARD_COLORS.map((card) => {
          const count = myPenalties.filter((p) => p.card === card).length;
          return (
            <span
              key={card}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-2xl font-bold transition-opacity ${CARD_CHIP_BG[card]} ${
                count === 0 ? 'opacity-30' : ''
              }`}
            >
              <span className="inline-block h-3 w-3 rounded-sm bg-white/70" />
              {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Centre column ─────────────────────────────────────────────────

function CenterColumn({
  match,
  clockStatus,
  elapsedMs,
  penalties,
  countdownRemaining,
  redName,
  blueName,
  t,
}: {
  match: DisplayMatch;
  clockStatus: 'idle' | 'running' | 'halted' | 'ended';
  elapsedMs: number;
  penalties: Penalty[];
  countdownRemaining: number | null;
  redName: string;
  blueName: string;
  t: (k: string, p?: Record<string, string>) => string;
}) {
  const isEnded = clockStatus === 'ended';
  // Double cap reached: both fighters lose, scores are 0-0 (so the
  // score-derived winner below is null too). end_reason disambiguates
  // this from a genuine tie.
  const isDoubleLoss = isEnded && match.endReason === 'max_doubles';
  // A black card closed the match: the carded fighter forfeits, the opponent
  // wins (fixed-loss score makes the winner score-derivable below).
  const isBlackCard = isEnded && match.endReason === 'black_card';
  const winner = useMemo(() => {
    if (!isEnded) return null;
    if (match.redScore > match.blueScore) return { side: 'red' as const, name: redName };
    if (match.blueScore > match.redScore) return { side: 'blue' as const, name: blueName };
    return null;
  }, [isEnded, match.redScore, match.blueScore, redName, blueName]);

  return (
    <div className="flex flex-col items-center gap-4 pt-6">
      <span
        className={`rounded-full px-4 py-1 text-base font-bold uppercase tracking-widest ${
          clockStatus === 'running'
            ? 'bg-green-900 text-green-300'
            : clockStatus === 'halted'
              ? 'bg-yellow-900 text-yellow-300'
              : clockStatus === 'ended'
                ? 'bg-gray-800 text-gray-400'
                : 'bg-gray-800 text-gray-500'
        }`}
      >
        {clockStatus}
      </span>

      {isEnded ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          {isDoubleLoss ? (
            <>
              <p className="text-7xl font-black uppercase tracking-widest text-red-500">
                {t('scoring.liveMatch.doubleLoss')}
              </p>
              <p className="text-3xl font-bold text-red-300">
                {t('scoring.liveMatch.doubleLossSubtitle')}
              </p>
            </>
          ) : isBlackCard ? (
            <>
              <p className="text-7xl font-black uppercase tracking-widest text-red-500">
                {t('scoring.liveMatch.blackCard')}
              </p>
              {winner && <p className="text-5xl font-bold">🏆 {winner.name}</p>}
            </>
          ) : (
            <>
              <p className="text-7xl font-black uppercase tracking-widest text-amber-400">
                MATCH ENDED
              </p>
              {winner && <p className="text-5xl font-bold">🏆 {winner.name}</p>}
            </>
          )}
          {countdownRemaining !== null && (
            <p className="mt-4 text-2xl text-gray-400">Next match in {countdownRemaining}…</p>
          )}
          {countdownRemaining === null && !match.nextMatchId && (
            <p className="mt-4 text-lg text-gray-500">Last match on this lice</p>
          )}
        </div>
      ) : (
        <>
          <p
            className={`font-mono text-9xl font-black tabular-nums leading-none ${
              clockStatus === 'running'
                ? 'text-white'
                : clockStatus === 'halted'
                  ? 'text-yellow-400'
                  : 'text-gray-600'
            }`}
          >
            {formatClockMs(elapsedMs)}
          </p>
          {match.startedAt && (
            <p className="text-base uppercase tracking-widest text-gray-500">
              Total{' '}
              <span className="font-mono">
                {formatClockMs(Date.now() - new Date(match.startedAt).getTime())}
              </span>
            </p>
          )}
        </>
      )}

      {/* Events list — last 8 active */}
      <div className="mt-4 w-full">
        <p className="mb-2 text-center text-sm font-bold uppercase tracking-widest text-gray-500">
          ── EVENTS ──
        </p>
        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-2">
          {penalties.filter((p) => !p.voided).length === 0 && (
            <p className="text-center text-base text-gray-600 py-2">—</p>
          )}
          {penalties
            .filter((p) => !p.voided)
            .slice(-8)
            .reverse()
            .map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-lg">
                <span
                  className={`inline-block h-4 w-4 rounded-sm ${
                    p.card === 'yellow'
                      ? 'bg-yellow-400'
                      : p.card === 'red'
                        ? 'bg-red-600'
                        : 'bg-gray-900 border border-gray-600'
                  }`}
                />
                <span className="font-semibold text-gray-100 truncate">
                  {p.short_name ?? p.reason ?? p.card}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────

function TVFooter({
  match,
  t: _t,
}: {
  match: DisplayMatch;
  t: (k: string, p?: Record<string, string>) => string;
}) {
  const tournamentName = match.tournament?.name ?? null;
  const liceName = match.lice?.name ?? null;
  return (
    <footer className="border-t border-slate-700 bg-white px-6 py-2 text-center text-sm text-slate-600">
      {tournamentName && <span className="font-semibold">{tournamentName}</span>}
      {tournamentName && liceName && <span className="mx-2">·</span>}
      {liceName && <span>{liceName}</span>}
    </footer>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((clamped % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(
    centiseconds,
  ).padStart(2, '0')}`;
}
