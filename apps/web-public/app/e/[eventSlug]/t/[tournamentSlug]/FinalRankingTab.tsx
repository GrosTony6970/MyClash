'use client';

/**
 * Final Ranking — the public mirror of the admin Final ranking page. Renders
 * the same tokenized table (Rank / Fighter / Result / Pool score, medals on the
 * top 3, club pills) using the SHARED `computeFinalRanking` from `@myclash/ui`,
 * so the public order matches the admin exactly — including the "Pools" tail of
 * fighters who competed but never reached the bracket.
 *
 * Pool scores come from the overall pool-standings endpoint (fetched client-
 * side, same as StandingsView); the ranking itself is derived from the bracket
 * slots already passed in by the page SSR.
 *
 * Visibility on the parent TournamentTabs is always TRUE so visitors know the
 * section exists; the content gates on the bracket actually being decided.
 */

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import {
  computeFinalRanking,
  rankingBracketShape,
  type FinalRankingEntry,
  type PoolEntry,
  type RankingSlot,
} from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { SelfRowFocus } from './SelfRowFocus';
import type { BracketSlot } from './page';

interface Props {
  /**
   * True when the bracket has a decided champion + runner-up. Drives whether
   * the ranking renders, or a "not ready yet" placeholder.
   */
  isTournamentCompleted: boolean;
  tournamentId: string;
  bracketSlots: BracketSlot[];
  /** Bracket format. Double-elim is ranked by losers-bracket exit, not by the
   *  round of a fighter's first loss. Absent → single-elim. */
  phaseType?: 'single_elim' | 'double_elim';
  wbRounds?: number | null;
  lbRounds?: number | null;
  /** Bronze mode reads gold/silver off the winners-bracket final instead of a
   *  grand final, and a repechage cutoff makes pre-cutoff winners-bracket
   *  losses final — both change the order, so both must reach the ranking. */
  secondChanceTarget?: 'gold' | 'bronze' | null;
  bronzeMatch?: boolean | null;
  repechageEntryRound?: number | null;
  /** Personal space: mark the viewer's own row with a "YOU" chip. */
  highlightRegistrationId?: string | null;
}

/** Personal-space "YOU" chip marking the viewer's own row. */
function YouChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-bold uppercase leading-none text-accent-foreground">
      {label}
    </span>
  );
}

interface OverallStandingsRow {
  registrationId: string;
  displayName: string;
  club: { name: string; abbreviation: string | null } | null;
  stats: Record<string, number | string>;
}

export function FinalRankingTab({
  isTournamentCompleted,
  tournamentId,
  bracketSlots,
  phaseType,
  wbRounds,
  lbRounds,
  secondChanceTarget,
  bronzeMatch,
  repechageEntryRound,
  highlightRegistrationId,
}: Props) {
  const [poolEntries, setPoolEntries] = useState<PoolEntry[]>([]);

  // Pool scores for the tiebreak + the "Pools" tail. Resolve client-side:
  // getPublicApiUrl() returns the browser-reachable public URL (a server-passed prop
  // would be the docker-internal host, unreachable from the browser).
  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = getPublicApiUrl();
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=overall`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows = (data as { rows?: OverallStandingsRow[] } | null)?.rows ?? [];
        setPoolEntries(
          rows.map((row) => {
            const raw = row.stats?.['score'];
            const n = typeof raw === 'number' ? raw : Number(raw);
            return {
              registrationId: row.registrationId,
              fighterName: row.displayName,
              clubAbbrev: row.club?.abbreviation ?? row.club?.name ?? null,
              poolScore: Number.isFinite(n) ? n : null,
            };
          }),
        );
      })
      .catch(() => {
        // Swallow — the ranking still renders from bracket data, just without
        // pool scores / the non-bracket tail.
      });
    return () => controller.abort();
  }, [tournamentId]);

  if (!isTournamentCompleted) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        {t('publicApp.tournament.finalRankingPending')}
      </div>
    );
  }

  const rankingSlots: RankingSlot[] = bracketSlots.map((s) => ({
    id: s.id,
    round: s.round,
    position: s.position,
    status: s.status,
    redRegistrationId: s.redRegistrationId ?? null,
    blueRegistrationId: s.blueRegistrationId ?? null,
    redFighterName: s.redFighterName,
    blueFighterName: s.blueFighterName,
    redClubAbbrev: s.redClubAbbrev ?? null,
    blueClubAbbrev: s.blueClubAbbrev ?? null,
    redScore: s.redScore,
    blueScore: s.blueScore,
    winnerRegistrationId: s.winnerRegistrationId ?? null,
  }));

  const maxRound = rankingSlots.reduce((m, s) => Math.max(m, s.round), 0);
  const ranking = computeFinalRanking(
    rankingSlots,
    poolEntries,
    null,
    rankingBracketShape({
      phaseType,
      wbRounds,
      lbRounds,
      secondChanceTarget,
      bronzeMatch,
      repechageEntryRound,
    }),
  );

  if (ranking.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        {t('publicApp.tournament.finalRankingComputing')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      {/* Personal space: scroll the viewer's own row into view on landing. */}
      <SelfRowFocus panelId="panel-finalranking" active={!!highlightRegistrationId} />
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="w-16 px-4 py-2 text-center">
              {t('publicApp.tournament.finalRanking.colRank')}
            </th>
            <th className="px-4 py-2">{t('publicApp.tournament.finalRanking.colFighter')}</th>
            <th className="px-4 py-2">{t('publicApp.tournament.finalRanking.colResult')}</th>
            <th className="px-4 py-2 text-right">
              {t('publicApp.tournament.finalRanking.colPoolScore')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((entry) => {
            const poolScoreText = entry.poolScore != null ? entry.poolScore.toFixed(2) : '—';
            const isYou =
              !!highlightRegistrationId && entry.registrationId === highlightRegistrationId;
            return (
              <tr
                key={entry.registrationId}
                data-self-row={isYou ? '' : undefined}
                className={[
                  'border-b border-border last:border-0 hover:bg-background',
                  isYou ? 'bg-accent/5' : '',
                ].join(' ')}
              >
                <td className="px-4 py-2 text-center font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    {medalFor(entry.place)}
                    {entry.place}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={isYou ? 'font-bold text-accent' : 'font-medium text-foreground'}>
                    {entry.fighterName}
                  </span>
                  {isYou && <YouChip label={t('publicApp.me.hub.youChip')} />}
                  {entry.clubAbbrev && (
                    <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
                      {entry.clubAbbrev}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-foreground-secondary">
                  {resultLabel(entry, maxRound)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-foreground-secondary">
                  {poolScoreText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function medalFor(place: number): string {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return '';
}

function resultLabel(entry: FinalRankingEntry, maxRound: number): string {
  switch (entry.resultKind) {
    case 'champion':
      return t('publicApp.tournament.finalRanking.champion');
    case 'runnerUp':
      return t('publicApp.tournament.finalRanking.runnerUp');
    case 'third':
      return t('publicApp.tournament.finalRanking.third');
    case 'fourth':
      return t('publicApp.tournament.finalRanking.fourth');
    case 'round':
      return roundLabel(entry.eliminationRound ?? 0, maxRound);
    case 'pool':
      return t('publicApp.tournament.finalRanking.pools');
    case 'swiss':
      // Placed by the Swiss standings, not eliminated in a round — so the
      // label names the format rather than a bracket stage.
      return t('publicApp.tournament.finalRanking.swiss');
  }
}

/** Phase name for the round a fighter was eliminated in (deepest = Semi-finals). */
function roundLabel(round: number, maxRound: number): string {
  const remaining = maxRound - round;
  if (remaining <= 0) return t('publicApp.tournament.finalRanking.final');
  if (remaining === 1) return t('publicApp.tournament.finalRanking.semiFinals');
  if (remaining === 2) return t('publicApp.tournament.finalRanking.quarterFinals');
  return t('publicApp.tournament.finalRanking.roundOf', { count: 1 << (remaining + 1) });
}
