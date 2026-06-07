'use client';

import * as React from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchFormatConfig } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { createTranslator, getMessages } from '@myclash/i18n';
import { formatFightOfTotal } from './format-fight-of-total';
import { useLiveMatch, type Penalty } from '../hooks/useLiveMatch';

export interface MatchScoreboardProps {
  matchId: string;
  apiBaseUrl: string;
  supabaseClient: SupabaseClient;
  /** Show the "Next match" preview footer. Default true. */
  showNextMatch?: boolean;
  /** Extra Tailwind classes for the root container. */
  className?: string;
}

// ── Internal types ────────────────────────────────────────────────────────────
// DisplayMatch / Penalty / ClockSnapshot moved to the shared
// useLiveMatch hook so both this component and TVScoreboard read
// from one source-of-truth.

// ── Color map ─────────────────────────────────────────────────────────────────

const DISPLAY_COLOR_STYLE = {
  white: '#f8fafc',
  black: '#f8fafc',
  grey: '#cbd5e1',
  yellow: '#facc15',
  red: '#ef4444',
  blue: '#60a5fa',
  green: '#4ade80',
  brown: '#a16207',
  pink: '#f472b6',
  orange: '#fb923c',
  purple: '#c084fc',
} as const;

// ── Helper functions ──────────────────────────────────────────────────────────

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

function displayClockMs(elapsedMs: number, matchFormat: MatchFormatConfig): number {
  const limitSeconds = matchFormat.timeLimitsSeconds.bracket;
  if (matchFormat.timerMode === 'countdown' && limitSeconds !== null) {
    return Math.max(0, limitSeconds * 1000 - elapsedMs);
  }
  return elapsedMs;
}

function shouldWarnClock(elapsedMs: number, matchFormat: MatchFormatConfig): boolean {
  const limitSeconds = matchFormat.timeLimitsSeconds.bracket;
  if (limitSeconds === null) return false;
  return Math.max(0, limitSeconds * 1000 - elapsedMs) < 10_000;
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function FighterPanel({
  color,
  name,
  score,
  club,
  penalties,
}: {
  color: keyof typeof DISPLAY_COLOR_STYLE;
  name: string;
  score: number;
  club: { name: string; logoUrl: string | null } | null;
  penalties: Penalty[];
}): React.ReactElement {
  return (
    <div className="text-center">
      {/* Big score — was below the name; now sits at the top of the
          column so the name + club + cards form a labelled block
          below it (matches the operator-approved Layout A). */}
      <p
        className="text-[16rem] font-black leading-none tabular-nums"
        style={{ color: DISPLAY_COLOR_STYLE[color] }}
      >
        {score}
      </p>
      <p className="mt-6 text-6xl font-black uppercase tracking-wide leading-tight">{name}</p>
      <div className="mt-3 flex flex-col items-center gap-1.5">
        <p className="text-3xl font-bold uppercase tracking-wide leading-tight">{name}</p>
        {club && (
          <div className="flex items-center justify-center gap-2 text-2xl text-gray-300">
            {club.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={club.logoUrl}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-full border border-white/20 bg-white/5 object-contain"
              />
            )}
            <span>{club.name}</span>
          </div>
        )}
      </div>
      {penalties.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-1.5" aria-label="Penalty cards">
          {penalties.map((p) => (
            <span
              key={p.id}
              title={p.card}
              className={[
                'h-6 w-4 rounded-sm border border-white/30 shadow',
                p.card === 'yellow'
                  ? 'bg-yellow-400'
                  : p.card === 'red'
                    ? 'bg-red-600'
                    : 'bg-black',
              ].join(' ')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MatchScoreboard({
  matchId,
  apiBaseUrl,
  supabaseClient,
  showNextMatch = true,
  className,
}: MatchScoreboardProps): React.ReactElement | null {
  const t = createTranslator(getMessages());

  const { match, penalties, clock, elapsedMs, loadError, refresh } = useLiveMatch(
    apiBaseUrl,
    matchId,
    supabaseClient,
  );

  if (loadError) {
    return (
      <div
        className={`flex min-h-[400px] flex-col items-center justify-center gap-3 bg-slate-900 p-8 text-slate-100 ${className ?? ''}`}
      >
        <p className="text-lg font-semibold">
          {t('organizer.scoreboard.loadError', { status: String(loadError.status) })}
        </p>
        {loadError.message && <p className="text-sm text-slate-300">{loadError.message}</p>}
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-2 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
        >
          {t('organizer.scoreboard.retry')}
        </button>
      </div>
    );
  }

  if (!match) {
    return (
      <div
        className={`flex min-h-[400px] flex-col items-center justify-center gap-3 bg-slate-900 p-8 text-slate-100 ${className ?? ''}`}
      >
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        <p className="text-sm text-slate-300">{t('organizer.scoreboard.loading')}</p>
      </div>
    );
  }

  const activePenalties = penalties.filter((penalty) => !penalty.voided);
  const sideColors =
    match.scoringConfig?.display?.sideColors ?? DEFAULT_SCORING_CONFIG.display.sideColors;
  const matchFormat = match.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG;
  const shownMs = formatClockMs(displayClockMs(elapsedMs, matchFormat));
  const warnClock = shouldWarnClock(elapsedMs, matchFormat);
  // External-display redesign: split the realtime penalty list per
  // side so each FighterPanel can render its own card row.
  const redPenalties = activePenalties.filter(
    (p) => match.redRegistrationId && p.registration_id === match.redRegistrationId,
  );
  const bluePenalties = activePenalties.filter(
    (p) => match.blueRegistrationId && p.registration_id === match.blueRegistrationId,
  );

  const redPanel = {
    color: sideColors.red,
    name: match.redFighterName ?? t('scoring.liveMatch.red'),
    score: match.redScore,
    club: match.redClub ?? null,
    penalties: redPenalties,
  };
  const bluePanel = {
    color: sideColors.blue,
    name: match.blueFighterName ?? t('scoring.liveMatch.blue'),
    score: match.blueScore,
    club: match.blueClub ?? null,
    penalties: bluePenalties,
  };
  const panels: [typeof redPanel, typeof bluePanel] =
    match.sideOrder === 'blue_left' ? [bluePanel, redPanel] : [redPanel, bluePanel];

  // Compact title strip — drops the duplicate matchNumberLabel line
  // and the standalone roundCode block in favour of one breadcrumb:
  //   Tournament · Lice · Pool · Fight X / Y
  // The roundCode survives as a tiny mono caption underneath
  // because operators read it on the mic during callouts.
  const fightOfTotal = formatFightOfTotal(match.fightIndex, match.totalFightsInPool);
  const titleSegments = [
    match.tournament?.name,
    match.lice?.name,
    match.poolName,
    fightOfTotal,
  ].filter(Boolean);

  return (
    <main className={`bg-black text-white ${className ?? ''}`}>
      <div className="flex min-h-screen flex-col px-10 py-8">
        {/* Compact title strip — replaces the two duplicate
            identifier lines (matchNumberLabel + roundCode) with one
            breadcrumb. Status pill stays on the right. */}
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-400">
              {t('scoring.liveMatch.displayTitle')}
            </p>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-wide">
              {titleSegments.join(' · ') || match.event?.name || 'MyClash'}
            </h1>
            {match.roundCode && (
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-amber-300/80">
                {match.roundCode}
              </p>
            )}
          </div>
          <div className="rounded-full border border-white/20 px-5 py-2 text-lg font-bold uppercase">
            {t(`scoring.liveMatch.status.${match.status}`)}
          </div>
        </header>

        {/* Timer — centred above the score columns, big and
            monospaced so the spectator can read it from the back of
            the hall. */}
        <div
          className={`mt-6 text-center text-8xl font-black tabular-nums ${
            warnClock ? 'text-red-500' : 'text-amber-300'
          }`}
        >
          {shownMs}
        </div>

        {/* Two-column score block — each FighterPanel stacks score
            → name → club logo + name → penalty card row. */}
        <section className="mt-8 grid flex-1 grid-cols-[1fr_auto_1fr] items-start gap-10">
          <FighterPanel
            color={panels[0].color}
            name={panels[0].name}
            score={panels[0].score}
            club={panels[0].club}
            penalties={panels[0].penalties}
          />
          <div className="self-center text-7xl font-black text-gray-500">-</div>
          <FighterPanel
            color={panels[1].color}
            name={panels[1].name}
            score={panels[1].score}
            club={panels[1].club}
            penalties={panels[1].penalties}
          />
        </section>

        {showNextMatch && (
          <footer className="border-t border-white/10 pt-6 text-right text-xl text-gray-300">
            {t('scoring.liveMatch.waitingForMatch')}
          </footer>
        )}
      </div>
    </main>
  );
}
