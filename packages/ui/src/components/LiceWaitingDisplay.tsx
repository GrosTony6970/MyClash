'use client';

import type { TournamentScoringConfig } from '@myclash/types';
import { sideStyle } from '../utils/side-color';

/**
 * Public TV-display "waiting" surface used by the per-lice route
 * (`/e/{eventSlug}/lice/{liceName}/display`) when the lice has no
 * currently running match. Mirrors TVScoreboard's chrome — white
 * branded header strip on top of a full-bleed dark stage — so the
 * arena audience sees a consistent visual identity between matches
 * instead of the previous bare `bg-black` placeholder.
 *
 * When the API returns a `queue` for the lice, the first upcoming
 * match is surfaced as a centred NEXT ▸ card with red/blue tints
 * resolved from the tournament's scoring config (same `sideStyle`
 * pipeline TVScoreboard uses). Empty queue shows a muted "no more
 * matches" line.
 */

export interface LiceWaitingDisplayNextMatch {
  redFighterName: string | null;
  blueFighterName: string | null;
  roundCode: string | null;
  matchNumberLabel: string | null;
  scoringConfig: TournamentScoringConfig | null;
  tournamentName: string | null;
}

export interface LiceWaitingDisplayProps {
  eventName: string | null;
  liceName: string;
  nextMatch: LiceWaitingDisplayNextMatch | null;
  /** i18n callable; consumer pipes its app-local t(). */
  t: (key: string, params?: Record<string, string>) => string;
  className?: string;
}

export function LiceWaitingDisplay({
  eventName,
  liceName,
  nextMatch,
  t,
  className,
}: LiceWaitingDisplayProps) {
  const matchCode = nextMatch?.roundCode ?? nextMatch?.matchNumberLabel ?? null;
  const redName = nextMatch?.redFighterName ?? null;
  const blueName = nextMatch?.blueFighterName ?? null;
  const redStyle = sideStyle(nextMatch?.scoringConfig ?? null, 'red');
  const blueStyle = sideStyle(nextMatch?.scoringConfig ?? null, 'blue');

  return (
    <div className={`flex min-h-screen flex-col bg-gray-950 text-white ${className ?? ''}`}>
      <header className="border-b border-slate-700 bg-white px-6 py-4 text-slate-900">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 text-left text-sm font-semibold text-slate-600">
            {eventName && <p className="truncate">◇ {eventName}</p>}
            <p className="text-xs uppercase tracking-widest text-slate-500">{liceName}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {t('scoring.liveMatch.status.scheduled')}
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-12 py-12 text-center">
        <p className="text-7xl font-black uppercase tracking-widest text-amber-400">
          {t('scoring.liveMatch.waitingForMatch')}
        </p>

        {nextMatch ? (
          <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-700 bg-slate-900/60 px-12 py-10 shadow-2xl">
            <span className="text-sm font-bold uppercase tracking-[0.3em] text-amber-400">
              {t('scoring.liveMatch.upNext')} ▸
            </span>
            {matchCode && (
              <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-5 py-1.5 font-mono text-2xl font-bold tracking-widest text-amber-700">
                {matchCode}
              </span>
            )}
            <p className="flex flex-wrap items-center justify-center gap-4 text-5xl font-bold leading-tight">
              <span style={{ color: redStyle.border }}>{redName ?? '—'}</span>
              <span className="text-2xl uppercase tracking-widest text-slate-500">
                {t('scoring.liveMatch.versus')}
              </span>
              <span style={{ color: blueStyle.border }}>{blueName ?? '—'}</span>
            </p>
            {nextMatch.tournamentName && (
              <p className="text-lg text-slate-400">{nextMatch.tournamentName}</p>
            )}
          </div>
        ) : (
          <p className="max-w-3xl text-3xl text-slate-400">{t('scoring.liveMatch.noQueue')}</p>
        )}
      </main>
    </div>
  );
}
