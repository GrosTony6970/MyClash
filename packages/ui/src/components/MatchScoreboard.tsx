'use client';

import * as React from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  displayClockMs,
  formatClockMs,
  shouldWarnClock,
} from '@myclash/types';
import { createTranslator, getMessages } from '@myclash/i18n';
import { formatFightOfTotal } from './format-fight-of-total';
import { useLiveMatch, type Penalty } from '../hooks/useLiveMatch';
import { sideColorsFor } from '../utils/side-color';

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

// Clock math (phase limit, countdown/count-up, formatting) lives in
// `@myclash/types` match-clock.ts — the one owner shared with the pad, the
// projector and the ruleset engine. The three helpers that used to sit here
// read `timeLimitsSeconds.bracket` unconditionally, so every pool bout and
// every medal match on this preview counted against the wrong limit.

// ── Sub-component ─────────────────────────────────────────────────────────────

function FighterPanel({
  color,
  name,
  score,
  club,
  penalties,
}: {
  /** Already-resolved hex for this side, clamped for the dark stage. */
  color: string;
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
      <p className="text-[16rem] font-black leading-none tabular-nums" style={{ color }}>
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

  const { match, penalties, elapsedMs, loadError, refresh } = useLiveMatch(
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
          {t('scoring.scoreboard.loadError', { status: String(loadError.status) })}
        </p>
        {loadError.message && <p className="text-sm text-slate-300">{loadError.message}</p>}
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-2 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
        >
          {t('scoring.scoreboard.retry')}
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
        <p className="text-sm text-slate-300">{t('scoring.scoreboard.loading')}</p>
      </div>
    );
  }

  const activePenalties = penalties.filter((penalty) => !penalty.voided);
  // Resolved once here rather than mapped inside FighterPanel: this is the
  // projector's near-black stage, so a side configured 'black' has to be
  // clamped or its score numeral vanishes. `sideColorsFor` is the same
  // resolution the pad and the public match page use.
  const sideColors = sideColorsFor(match.scoringConfig, 'dark');
  const matchFormat = match.matchFormat ?? DEFAULT_MATCH_FORMAT_CONFIG;
  const phaseType = match.phaseType ?? undefined;
  const shownMs = formatClockMs(
    displayClockMs(elapsedMs, matchFormat, phaseType, match.matchNumberLabel),
  );
  const warnClock = shouldWarnClock(elapsedMs, matchFormat, phaseType, match.matchNumberLabel);
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
