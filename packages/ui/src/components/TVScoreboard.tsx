'use client';

/**
 * TVScoreboard — read-only three-column scoreboard for the public
 * TV / projector display.
 *
 * Mirrors the redesigned referee scoreboard from
 * `apps/web-staff/src/components/MatchView.tsx` but strips every
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
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  displayClockMs,
  formatClockMs,
  resolveMatchWinner,
  shouldWarnClock,
} from '@myclash/types';
import { useLiveMatch, type DisplayMatch, type Penalty } from '../hooks/useLiveMatch';
import { isFreshnessAlarming } from '../hooks/realtime-freshness';
import { FreshnessChip } from './FreshnessChip';
import type { ClockEvent, ExchangeRow } from '../types/match-events';
import { sideStyle, legibleOn } from '../utils/side-color';
import { buildUnifiedTimeline } from '../utils/exchange-timeline';
import { roundLabel } from '../utils/round-label';
import { buildBoutFlow } from '../utils/bout-flow';
import { BoutFlowChart } from './BoutFlowChart';
import { MatchTimeline } from './MatchTimeline';
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

// Circular stage art (fighter photo, club logo). Tailwind v4 has no @theme
// namespace for h-/w-, so these can't be --text-stage-* siblings in theme.css —
// they live here instead, as the single owner of both diameters. Same rule as
// that scale: cap ÷ 19.2 as the vw slope, so each hits its cap at 1920px wide.
const STAGE_AVATAR = 'h-[clamp(3rem,6.67vw,8rem)] w-[clamp(3rem,6.67vw,8rem)]';
const STAGE_CLUB_LOGO = 'h-[clamp(2rem,4.17vw,5rem)] w-[clamp(2rem,4.17vw,5rem)]';

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
  // Stable identity: this component re-renders ~20×/s off the clock ticker, and
  // `t` is a dependency of the timeline memo below — rebuilding the translator
  // each tick would rebuild the whole event list with it, all day on a projector.
  const t = useMemo(() => createTranslator(getMessages()), []);
  // `connected` deliberately not read: it is a boolean about the SOCKET, and
  // this board asks about the DATA. A polling surface reports connected:false
  // while being perfectly fresh, which is exactly the ambiguity that let a dead
  // websocket look healthy here for weeks.
  const { match, penalties, exchanges, clock, elapsedMs, loadError, freshness } = useLiveMatch(
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

  // Alarm debounce. The channel acks SUBSCRIBED on a handshake that lands
  // AFTER the initial HTTP fetch, so a realtime-only surface is briefly
  // not-live on every single load. Wait a grace period before alarming; if the
  // state is still alarming after it, it is real — dropped mid-bout, or a
  // socket that never connects and would otherwise go silently stale, which is
  // the gap this cue exists to close.
  //
  // Keyed on `freshness.kind`, not on the object: `deriveFreshness` returns a
  // fresh object every render (this component re-renders ~20x/s off the clock
  // ticker) and depending on it would restart the timer forever.
  const [graceElapsed, setGraceElapsed] = useState(false);
  const alarming = isFreshnessAlarming(freshness);
  useEffect(() => {
    if (!alarming) {
      setGraceElapsed(false);
      return;
    }
    const id = setTimeout(() => setGraceElapsed(true), 4000);
    return () => clearTimeout(id);
  }, [alarming]);

  if (loadError) {
    return (
      <div
        className={`flex min-h-screen items-center justify-center bg-gray-950 p-8 text-white ${className ?? ''}`}
      >
        <div className="text-center">
          <p className="text-3xl font-bold">
            {t('scoring.scoreboard.loadError', { status: String(loadError.status) })}
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
          <span>{t('scoring.scoreboard.loading')}</span>
        </div>
      </div>
    );
  }

  const redName = match.redFighterName ?? t('scoring.lice.red');
  const blueName = match.blueFighterName ?? t('scoring.lice.blue');
  const redStyle = sideStyle(match.scoringConfig, 'red');
  const blueStyle = sideStyle(match.scoringConfig, 'blue');

  // Connection cue — one shared chip now, driven by the shared freshness state
  // rather than by two hand-rolled pills with hard-coded amber/green.
  //
  // Two suppressions survive the move, both about not alarming a projector
  // nobody is standing next to:
  //   - a FINISHED match is static, so there is nothing to be stale about;
  //   - the 4s debounce below covers the normal initial handshake, which lands
  //     after the first HTTP fetch and would otherwise flash on every load.
  // A working poll is no longer suppressed by special-casing `pollMs` at the
  // call site: `deriveFreshness` reports it as `polling`, and the chip renders
  // that as information rather than as an alarm.
  const isFinalMatch = match.status === 'completed' || match.status === 'voided';
  const isLiveBout = match.status === 'running' || match.status === 'paused';
  const showCue = !isFinalMatch && (alarming ? graceElapsed : isLiveBout);
  const connectionCue = showCue ? <FreshnessChip freshness={freshness} /> : null;

  const redColumn = (
    <FighterColumn
      key="red"
      name={redName}
      photoUrl={match.redFighterPhotoUrl ?? null}
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
      photoUrl={match.blueFighterPhotoUrl ?? null}
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
        t={t}
      />

      {/* The 380px centre floor yields below ~1267px (where 30vw drops under it).
          Without that `min()` a windowed display starves the fighter columns —
          they'd hold ~262px at 1000px wide while the numeral still demanded its
          full width, so the scores painted over the clock. Fluid type alone does
          not fix it: the floor has to move too. */}
      <div className="grid flex-1 grid-cols-[1fr_minmax(min(380px,30vw),28%)_1fr] gap-6 px-6 py-4">
        {leftColumn}
        <CenterColumn
          match={match}
          clockStatus={clockStatus}
          elapsedMs={elapsedMs}
          penalties={penalties}
          exchanges={exchanges}
          countdownRemaining={countdownRemaining}
          clockEvents={clock?.events}
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
  t,
}: {
  match: DisplayMatch;
  redName: string;
  blueName: string;
  redBorder: string;
  blueBorder: string;
  mirror?: boolean;
  connectionCue?: React.ReactNode;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const matchCode = match.roundCode ?? match.matchNumberLabel ?? '';
  const eventName = match.event?.name ?? null;
  const liceName = match.lice?.name ?? null;
  const next = match.nextMatch ?? null;
  // Tournament · Phase · Lice — mirrors the scoring pad header (MatchHeader)
  // so the operator and the TV read the same context. Bracket and Swiss
  // matches have no pool, so the round takes that slot — spelled out, because
  // this line is read by an audience across a hall, not by an operator who
  // knows the codes. The abbreviation stays in the match-code pill above.
  // Truthiness, not `??`: an empty poolName is not nullish and would silently
  // win over the round, leaving the phase slot blank (the pad's endpoint does
  // return '' for a non-pool match — see MatchHeader).
  const phaseLabel = match.poolName?.trim() ? match.poolName : roundLabel(match.roundToken, t);
  const contextLine = [match.tournament?.name ?? null, phaseLabel, liceName]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(' · ');
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
          {contextLine && <p className="text-sm font-semibold text-slate-500">{contextLine}</p>}
          <p className="text-stage-club font-bold">
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
  photoUrl,
  club,
  score,
  registrationId,
  penalties,
  tintHex,
}: {
  name: string;
  photoUrl: string | null;
  club: { name: string; logoUrl: string | null } | null;
  score: number;
  registrationId: string | null;
  penalties: Penalty[];
  tintHex: string;
}) {
  const myPenalties = penalties.filter((p) => !p.voided && p.registration_id === registrationId);
  const tint = legibleOn(tintHex, 'dark');
  return (
    <div className="flex flex-col items-center justify-start gap-6 pt-6">
      <p className="text-stage-score font-black leading-none tabular-nums" style={{ color: tint }}>
        {score}
      </p>
      {/* Fighter photo above the name; side-tinted initials when there's no
          photo so red vs blue stay distinguishable on the projector. */}
      <FighterAvatar name={name} photoUrl={photoUrl} tint={tint} />
      <p className="text-stage-name text-center font-bold leading-tight">{name}</p>
      {club && (
        <div className="text-stage-club flex items-center justify-center gap-3 text-gray-300">
          {club.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={club.logoUrl}
              alt=""
              width={80}
              height={80}
              className={`${STAGE_CLUB_LOGO} rounded-full border border-white/20 bg-white/5 object-contain`}
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
              className={`text-stage-club inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-bold transition-opacity ${CARD_CHIP_BG[card]} ${
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

// Fighter photo for the scoreboard column. Falls back to side-tinted
// initials (not the red-only packages/ui Avatar, which would mislabel the
// blue fighter) so both sides stay legible on a projector.
function FighterAvatar({
  name,
  photoUrl,
  tint,
}: {
  name: string;
  photoUrl: string | null;
  tint: string;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        width={128}
        height={128}
        className={`${STAGE_AVATAR} rounded-full border-4 object-cover`}
        style={{ borderColor: tint }}
      />
    );
  }
  return (
    <div
      className={`${STAGE_AVATAR} text-stage-name flex items-center justify-center rounded-full border-4 bg-white/5 font-black`}
      style={{ borderColor: tint, color: tint }}
    >
      {initials(name)}
    </div>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Centre column ─────────────────────────────────────────────────

function CenterColumn({
  match,
  clockStatus,
  elapsedMs,
  penalties,
  exchanges,
  countdownRemaining,
  clockEvents,
  redName,
  blueName,
  t,
}: {
  match: DisplayMatch;
  clockStatus: 'idle' | 'running' | 'halted' | 'ended';
  elapsedMs: number;
  penalties: Penalty[];
  exchanges: ExchangeRow[];
  countdownRemaining: number | null;
  clockEvents: ClockEvent[] | undefined;
  redName: string;
  blueName: string;
  t: (k: string, p?: Record<string, string>) => string;
}) {
  const isEnded = clockStatus === 'ended';
  // timerMode decides which way this numeral runs; the phase decides what it
  // counts against. The projector ignored both until now — it rendered raw
  // elapsed time, so a countdown tournament (the default) counted up all day.
  const matchFormat = match.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG;
  const clockArgs = [matchFormat, match.phaseType ?? undefined, match.matchNumberLabel] as const;
  const shownClockMs = displayClockMs(elapsedMs, ...clockArgs);
  const warnClock = shouldWarnClock(elapsedMs, ...clockArgs);
  // Double cap reached: both fighters lose, 0-0 with no recorded winner.
  // end_reason disambiguates this from a genuine tie.
  const isDoubleLoss = isEnded && match.endReason === 'max_doubles';
  // A black card closed the match: the carded fighter forfeits, the opponent
  // wins. The recorded winner is what says so — the fixed-loss score happens to
  // agree, but a keep-current injury forfeit does not, and neither does an
  // override that awards the bout to the fighter behind on points.
  const isBlackCard = isEnded && match.endReason === 'black_card';
  const winner = useMemo(() => {
    if (!isEnded) return null;
    const side = resolveMatchWinner({
      status: 'completed',
      winnerRegistrationId: match.winnerRegistrationId,
      redRegistrationId: match.redRegistrationId,
      blueRegistrationId: match.blueRegistrationId,
      redScore: match.redScore,
      blueScore: match.blueScore,
    });
    if (side === null) return null;
    return { side, name: side === 'red' ? redName : blueName };
  }, [
    isEnded,
    match.winnerRegistrationId,
    match.redRegistrationId,
    match.blueRegistrationId,
    match.redScore,
    match.blueScore,
    redName,
    blueName,
  ]);

  // The same numbered timeline the referee pad and the public match page show —
  // exchanges and cards merged into one contiguous 1..N sequence, newest first,
  // so "#6" means the same event on the projector and on the pad.
  const events = useMemo(
    () =>
      buildUnifiedTimeline({
        exchanges,
        penalties,
        redName,
        blueName,
        redRegId: match.redRegistrationId ?? '',
        blueRegId: match.blueRegistrationId ?? '',
        t,
        config: match.scoringConfig ?? DEFAULT_SCORING_CONFIG,
      }),
    [
      exchanges,
      penalties,
      redName,
      blueName,
      match.redRegistrationId,
      match.blueRegistrationId,
      match.scoringConfig,
      t,
    ],
  );

  // Same rows, read as momentum instead of history. Best-of shows the open
  // round only, so the chart and the big numerals never disagree.
  const flow = useMemo(
    () =>
      buildBoutFlow({
        exchanges,
        penalties,
        redRegId: match.redRegistrationId ?? '',
        blueRegId: match.blueRegistrationId ?? '',
        matchFormat: match.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG,
        endReason: match.endReason,
        bestOf: match.bestOf,
        currentRound: match.currentRound,
        clockEvents,
      }),
    [
      exchanges,
      penalties,
      match.redRegistrationId,
      match.blueRegistrationId,
      match.matchFormat,
      match.endReason,
      match.bestOf,
      match.currentRound,
      clockEvents,
    ],
  );

  return (
    // min-w-0 as a grid item: without it this column's min-content width wins
    // over the centre track and the timeline rows push into the score numerals.
    // Still needed now that the track floor is fluid — min-content doesn't care
    // what the floor is.
    <div className="flex min-w-0 flex-col items-center gap-4 pt-6">
      <span
        className={`text-stage-label rounded-full px-4 py-1 font-bold uppercase tracking-widest ${
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
              <p className="text-stage-verdict font-black uppercase tracking-widest text-red-500">
                {t('scoring.liveMatch.doubleLoss')}
              </p>
              <p className="text-stage-subtitle font-bold text-red-300">
                {t('scoring.liveMatch.doubleLossSubtitle')}
              </p>
            </>
          ) : isBlackCard ? (
            <>
              <p className="text-stage-verdict font-black uppercase tracking-widest text-red-500">
                {t('scoring.liveMatch.blackCard')}
              </p>
              {winner && <p className="text-stage-name font-bold">🏆 {winner.name}</p>}
            </>
          ) : (
            <>
              <p className="text-stage-verdict font-black uppercase tracking-widest text-amber-400">
                MATCH ENDED
              </p>
              {winner && <p className="text-stage-name font-bold">🏆 {winner.name}</p>}
            </>
          )}
          {countdownRemaining !== null && (
            <p className="text-stage-club mt-4 text-gray-400">
              Next match in {countdownRemaining}…
            </p>
          )}
          {countdownRemaining === null && !match.nextMatchId && (
            <p className="text-stage-row mt-4 text-gray-500">Last match on this lice</p>
          )}
        </div>
      ) : (
        <>
          <p
            className={`text-stage-clock font-mono font-black tabular-nums leading-none ${
              clockStatus === 'running'
                ? warnClock
                  ? 'text-red-500'
                  : 'text-white'
                : clockStatus === 'halted'
                  ? 'text-yellow-400'
                  : 'text-gray-600'
            }`}
          >
            {formatClockMs(shownClockMs)}
          </p>
          {match.startedAt && (
            <p className="text-stage-label uppercase tracking-widest text-gray-500">
              Total{' '}
              <span className="font-mono">
                {formatClockMs(Date.now() - new Date(match.startedAt).getTime())}
              </span>
            </p>
          )}
        </>
      )}

      {/* Bout flow — how the lead moved. No pointer on a projector, so it
          renders inert: no scrub handlers, no highlight. */}
      <div className="mt-4 w-full min-w-0">
        <BoutFlowChart
          series={flow}
          config={match.scoringConfig}
          redName={redName}
          blueName={blueName}
          surface="dark"
          scale="tv"
          t={t}
        />
      </div>

      {/* Exchange history — the full timeline, scrollable and pinned to the
          newest row (the projector has no operator to scroll it). */}
      <div className="mt-4 w-full min-w-0">
        <p className="text-stage-meta mb-2 text-center font-bold uppercase tracking-widest text-gray-500">
          {t('scoring.lice.eventsHeader')}
        </p>
        <MatchTimeline
          events={events}
          scale="tv"
          ariaLabel={t('scoring.lice.eventsHeader')}
          t={t}
        />
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

// Clock math and formatting live in `@myclash/types` match-clock.ts — the one
// owner shared with the scoring pad, the admin preview and the ruleset engine.
