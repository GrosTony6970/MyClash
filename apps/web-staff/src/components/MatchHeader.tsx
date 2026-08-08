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
 * In the default `hybrid` theme the header sits on a light surface even though
 * the central scoring zone below stays dark — operator decided "hybrid: light
 * chrome, dark scoring area" for visual unity with the admin app. That is why
 * the root element carries its own data-theme: semantic tokens inherit, so a
 * region that differs from <body> needs a scope to override with. The value is
 * no longer pinned — see src/theme/theme.ts for the mode → scope table.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
import { useScoringTheme } from '../theme/ThemeProvider';
import { ThemeSwitcher } from '../theme/ThemeSwitcher';
import { sideStyle, roundLabel } from '@myclash/ui';
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
  /** Round token for bracket / Swiss matches, which carry no pool. */
  roundToken?: string | null;
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
  roundToken,
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
  const { chromeScope } = useScoringTheme();
  const { previous, next } = useAdjacentMatches(apiUrl, matchId, refreshKey);
  // Tournament · Phase · Piste — skips any part that's missing. Bracket and
  // Swiss matches have no pool, and used to leave the phase slot empty; they
  // fill it from the round token instead, named the same way the TV names it.
  //
  // Truthiness, not `??`: GET /matches/:id/summary returns poolName as '' for a
  // non-pool match (the TV's endpoint returns null), and an empty string is not
  // nullish — `??` would keep it and the phase would never appear here at all.
  const phaseLabel = poolName?.trim() ? poolName : roundLabel(roundToken, t);
  const contextLine = [tournamentName, phaseLabel, liceName]
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
  // to client-route it inside web-staff and 404. The in-app /lices fallback
  // stays a <Link> for SPA navigation.
  const backIsExternal = isExternalHref(resolvedBackHref);
  const backClassName =
    'inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:border-muted hover:bg-background';
  const redStyle = sideStyle(config, 'red');
  const blueStyle = sideStyle(config, 'blue');

  return (
    // Own data-theme because the chrome may differ from <body>: under `hybrid`
    // this is light over a dark pad — you read it between bouts, not
    // mid-exchange. Without the scope the body's tokens inherit straight
    // through, which is why this file used to hardcode slate-*.
    <header
      data-theme={chromeScope}
      className="border-b border-border bg-surface text-foreground px-4 py-3"
    >
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
              className="block w-full max-w-[280px] rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-muted hover:bg-background"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                ◂ {t('scoring.lice.previousMatchLabel')}
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-tight">
                <span style={{ color: redStyle.border }}>● </span>
                {previous.redName}
                {previous.redClub && <span className="text-muted"> · {previous.redClub}</span>}
              </p>
              <p className="text-sm font-semibold leading-tight">
                <span style={{ color: blueStyle.border }}>● </span>
                {previous.blueName}
                {previous.blueClub && <span className="text-muted"> · {previous.blueClub}</span>}
              </p>
            </Link>
          )}
        </div>

        {/* Centre: match code pill + full fighter names + corrections */}
        <div className="flex flex-col items-center gap-1.5">
          {matchCode && (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-0.5 font-mono text-sm font-bold tracking-widest text-warning">
              {matchCode}
            </span>
          )}
          {bestOf > 1 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-3 py-0.5 text-xs font-bold text-info">
              {t('scoring.rounds.counter', {
                current: String(currentRound),
                total: String(bestOf),
              })}
              <span className="font-semibold tabular-nums">
                <span style={{ color: redStyle.border }}>{redRoundWins}</span>
                <span className="mx-0.5 text-muted">–</span>
                <span style={{ color: blueStyle.border }}>{blueRoundWins}</span>
              </span>
            </span>
          )}
          {contextLine && <span className="text-xs font-semibold text-muted">{contextLine}</span>}
          <p className="text-base font-semibold text-foreground">
            <span style={{ color: redStyle.border }}>{redName}</span>{' '}
            <span className="text-muted">{t('scoring.lice.vs')}</span>{' '}
            <span style={{ color: blueStyle.border }}>{blueName}</span>
          </p>
          <button
            type="button"
            onClick={onOpenCorrections}
            className="mt-1 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs font-semibold text-foreground-secondary hover:border-muted hover:bg-background"
          >
            ⋯ {t('scoring.lice.matchActions')}
          </button>
        </div>

        {/* Right: theme + external display + next-match tile */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            {displayUrl && (
              <button
                type="button"
                onClick={() => openScoreboardPopup(displayUrl)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:border-muted hover:bg-background"
              >
                ↗ {t('scoring.lice.externalDisplay')}
              </button>
            )}
          </div>

          {next && (
            <Link
              href={buildMatchHref(next.id)}
              className="block w-full max-w-[280px] rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-muted hover:bg-background"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                {t('scoring.lice.nextMatchLabel')} ▸
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-tight">
                <span style={{ color: redStyle.border }}>● </span>
                {next.redName}
                {next.redClub && <span className="text-muted"> · {next.redClub}</span>}
              </p>
              <p className="text-sm font-semibold leading-tight">
                <span style={{ color: blueStyle.border }}>● </span>
                {next.blueName}
                {next.blueClub && <span className="text-muted"> · {next.blueClub}</span>}
              </p>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
