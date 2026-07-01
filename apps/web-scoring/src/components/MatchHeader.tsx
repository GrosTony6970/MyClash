'use client';

/**
 * MatchHeader — light-chrome top strip for the redesigned scoreboard.
 *
 * Layout (left → right):
 *   ← Back to match list
 *   [ MATCH-CODE pill ] / Tony Garnier vs Jane Doe / ⚙ Corrections
 *   ↗ External display
 *   [ NEXT-MATCH tile ]
 *
 * The header sits in light surfaces (white background, slate borders)
 * even though the central scoring zone below stays dark — operator
 * decided "hybrid: light chrome, dark scoring area" for visual unity
 * with the admin app.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
import { sideStyle } from '@myclash/ui';
import { useAdjacentMatches } from '@myclash/ui';
import {
  displayUrlForMatch,
  isExternalHref,
  openScoreboardPopup,
  retargetScoreboardPopupIfOpen,
} from '../lib/nav';

interface MatchHeaderProps {
  matchId: string;
  apiUrl: string;
  matchCode: string;
  /** Header context line: Tournament · Pool · Piste (from match summary). */
  tournamentName?: string | null;
  poolName?: string | null;
  liceName?: string | null;
  redName: string;
  blueName: string;
  config: TournamentScoringConfig;
  /** Lice id — back-link destination + next-match query. */
  liceId: string | null;
  /** Returns href for next-match navigation. Defaults to /matches/[id]. */
  buildMatchHref?: (matchId: string) => string;
  /** Optional override for back-link href (otherwise /lices/[liceId]). */
  backHref?: string | null;
  externalDisplayUrl?: string | null;
  /** Bumped when something might have changed the lice queue. */
  refreshKey: number;
  /** Called when ⚙ Corrections is tapped. */
  onOpenCorrections: () => void;
  /** Best-of-N round state — the round counter chip only shows when bestOf > 1. */
  bestOf?: number;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
}

export function MatchHeader({
  matchId,
  apiUrl,
  matchCode,
  tournamentName,
  poolName,
  liceName,
  redName,
  blueName,
  config,
  liceId,
  buildMatchHref = (id) => `/matches/${id}`,
  backHref,
  externalDisplayUrl,
  refreshKey,
  onOpenCorrections,
  bestOf = 1,
  currentRound = 1,
  redRoundWins = 0,
  blueRoundWins = 0,
}: MatchHeaderProps) {
  const { t } = useI18n();
  const { previous, next } = useAdjacentMatches(apiUrl, matchId, refreshKey);
  // Tournament · Pool · Piste — skips any part that's missing (e.g. bracket matches have no pool).
  const contextLine = [tournamentName, poolName, liceName]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(' · ');

  // The projection URL for the match currently on the pad (the passed
  // externalDisplayUrl is pinned to whichever match the admin proxied in, so
  // re-derive it per match). If the operator has an external-display popup
  // open, retarget it whenever we land on a new match so the projector follows.
  const displayUrl = displayUrlForMatch(externalDisplayUrl, matchId);
  useEffect(() => {
    if (displayUrl) retargetScoreboardPopupIfOpen(displayUrl);
  }, [displayUrl]);

  const resolvedBackHref = backHref ?? (liceId ? `/lices/${liceId}` : '/lices');
  // An absolute `?return=` target is a different app behind the same origin
  // (admin), so it needs a real browser navigation — a Next <Link> would try
  // to client-route it inside web-scoring and 404. The in-app /lices fallback
  // stays a <Link> for SPA navigation.
  const backIsExternal = isExternalHref(resolvedBackHref);
  const backClassName =
    'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500 hover:bg-slate-50';
  const redStyle = sideStyle(config, 'red');
  const blueStyle = sideStyle(config, 'blue');

  return (
    <header className="border-b border-slate-200 bg-white text-slate-900 px-4 py-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        {/* Left: back link + previous-match tile */}
        <div className="flex flex-col items-start gap-2">
          {backIsExternal ? (
            <a href={resolvedBackHref} className={backClassName}>
              ← {t('scoring.lice.backToMatchList')}
            </a>
          ) : (
            <Link href={resolvedBackHref} className={backClassName}>
              ← {t('scoring.lice.backToMatchList')}
            </Link>
          )}

          {previous && (
            <Link
              href={buildMatchHref(previous.id)}
              className="block w-full max-w-[280px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-left hover:border-slate-500 hover:bg-slate-50"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                ◂ {t('scoring.lice.previousMatchLabel')}
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-tight">
                <span style={{ color: redStyle.border }}>● </span>
                {previous.redName}
                {previous.redClub && <span className="text-slate-500"> · {previous.redClub}</span>}
              </p>
              <p className="text-sm font-semibold leading-tight">
                <span style={{ color: blueStyle.border }}>● </span>
                {previous.blueName}
                {previous.blueClub && (
                  <span className="text-slate-500"> · {previous.blueClub}</span>
                )}
              </p>
            </Link>
          )}
        </div>

        {/* Centre: match code pill + full fighter names + corrections */}
        <div className="flex flex-col items-center gap-1.5">
          {matchCode && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-0.5 font-mono text-sm font-bold tracking-widest text-amber-700">
              {matchCode}
            </span>
          )}
          {bestOf > 1 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-3 py-0.5 text-xs font-bold text-sky-700">
              {t('scoring.rounds.counter', {
                current: String(currentRound),
                total: String(bestOf),
              })}
              <span className="font-semibold tabular-nums">
                <span style={{ color: redStyle.border }}>{redRoundWins}</span>
                <span className="mx-0.5 text-slate-400">–</span>
                <span style={{ color: blueStyle.border }}>{blueRoundWins}</span>
              </span>
            </span>
          )}
          {contextLine && (
            <span className="text-xs font-semibold text-slate-500">{contextLine}</span>
          )}
          <p className="text-base font-semibold text-slate-900">
            <span style={{ color: redStyle.border }}>{redName}</span>{' '}
            <span className="text-slate-500">{t('scoring.lice.vs')}</span>{' '}
            <span style={{ color: blueStyle.border }}>{blueName}</span>
          </p>
          <button
            type="button"
            onClick={onOpenCorrections}
            className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-500 hover:bg-slate-50"
          >
            ⋯ {t('scoring.lice.matchActions')}
          </button>
        </div>

        {/* Right: external display + next-match tile */}
        <div className="flex flex-col items-end gap-2">
          {displayUrl && (
            <button
              type="button"
              onClick={() => openScoreboardPopup(displayUrl)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500 hover:bg-slate-50"
            >
              ↗ {t('scoring.lice.externalDisplay')}
            </button>
          )}

          {next && (
            <Link
              href={buildMatchHref(next.id)}
              className="block w-full max-w-[280px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-left hover:border-slate-500 hover:bg-slate-50"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {t('scoring.lice.nextMatchLabel')} ▸
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-tight">
                <span style={{ color: redStyle.border }}>● </span>
                {next.redName}
                {next.redClub && <span className="text-slate-500"> · {next.redClub}</span>}
              </p>
              <p className="text-sm font-semibold leading-tight">
                <span style={{ color: blueStyle.border }}>● </span>
                {next.blueName}
                {next.blueClub && <span className="text-slate-500"> · {next.blueClub}</span>}
              </p>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
