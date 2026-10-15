'use client';

import type { TournamentScoringConfig } from '@myclash/types';
import { useWakeLock } from '../hooks/useWakeLock';
import { sideStyle } from '../utils/side-color';
import { statusLabelKey } from '../utils/status-label';

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
  /** Blue is named first, as the scoreboard that follows will show it (see TVScoreboard). */
  mirror?: boolean;
  className?: string;
}

export function LiceWaitingDisplay({
  eventName,
  liceName,
  nextMatch,
  t,
  mirror = false,
  className,
}: LiceWaitingDisplayProps) {
  // The hall's TV sits on this card longer than on any bout: it must not sleep.
  useWakeLock();
  const matchCode = nextMatch?.roundCode ?? nextMatch?.matchNumberLabel ?? null;
  const red = {
    name: nextMatch?.redFighterName ?? null,
    color: sideStyle(nextMatch?.scoringConfig ?? null, 'red').border,
  };
  const blue = {
    name: nextMatch?.blueFighterName ?? null,
    color: sideStyle(nextMatch?.scoringConfig ?? null, 'blue').border,
  };
  const [left, right] = mirror ? [blue, red] : [red, blue];

  return (
    <div
      className={`flex min-h-screen flex-col bg-stage text-stage-foreground cursor-none ${className ?? ''}`}
    >
      <header className="border-b border-slate-700 bg-white px-6 py-4 text-slate-900">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 text-left text-sm font-semibold text-slate-600">
            {eventName && <p className="truncate">◇ {eventName}</p>}
            <p className="text-xs uppercase tracking-widest text-slate-500">{liceName}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {t(statusLabelKey('match', 'scheduled'))}
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-12 py-12 text-center">
        <p className="text-stage-verdict font-black uppercase tracking-widest text-amber-400">
          {t('scoring.liveMatch.waitingForMatch')}
        </p>

        {nextMatch ? (
          <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-700 bg-slate-900/60 px-12 py-10 shadow-2xl">
            <span className="text-sm font-bold uppercase tracking-[0.3em] text-amber-400">
              {t('scoring.liveMatch.upNext')} ▸
            </span>
            {matchCode && (
              <span className="text-stage-club rounded-full border-2 border-amber-300 bg-amber-50 px-5 py-1.5 font-mono font-bold tracking-widest text-amber-700">
                {matchCode}
              </span>
            )}
            <p className="text-stage-name flex flex-wrap items-center justify-center gap-4 font-bold leading-tight">
              <span style={{ color: left.color }}>{left.name ?? '—'}</span>
              <span className="text-stage-club uppercase tracking-widest text-slate-500">
                {t('scoring.liveMatch.versus')}
              </span>
              <span style={{ color: right.color }}>{right.name ?? '—'}</span>
            </p>
            {nextMatch.tournamentName && (
              <p className="text-stage-row text-slate-400">{nextMatch.tournamentName}</p>
            )}
          </div>
        ) : (
          <p className="text-stage-subtitle max-w-3xl text-slate-400">
            {t('scoring.liveMatch.noQueue')}
          </p>
        )}
      </main>
    </div>
  );
}
