'use client';

/**
 * Final ranking — Route: /org/[slug]/events/[eventId]/finalranking
 *
 * The admin mirror of the public final-ranking tab: the bracket placement
 * (Champion → Runner-up → 3rd/4th → earlier rounds), with fighters eliminated
 * in the same round separated by their pool score. Data: GET /tournaments/:id/
 * bracket + GET /tournaments/:id/pool-standings?mode=overall (pool scores).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  TournamentColorDot,
  computeFinalRanking,
  rankingBracketShape,
  type FinalRankingEntry,
  type PoolEntry,
  type RankingSlot,
} from '@myclash/ui';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { rankingToCsv, rankingToPrintHtml, type ExportRow } from './final-ranking-export';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

type Translator = (key: string, values?: Record<string, string | number>) => string;

interface Tournament {
  id: string;
  name: string;
  color?: string | null;
}

interface BracketResponse {
  phaseId?: string;
  phaseType?: string;
  /** Double-elim round split — needed so the ranking places fighters by their
   *  losers-bracket exit rather than by the round of their first loss. */
  wbRounds?: number | null;
  lbRounds?: number | null;
  bronzeSlotId?: string | null;
  slots: RankingSlot[];
}

interface StandingsRow {
  registrationId: string;
  displayName: string;
  club: { name: string; abbreviation: string | null } | null;
  stats: Record<string, number | string>;
}

const apiUrl = getPublicApiUrl();

export default function FinalRankingPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>(
    searchParams.get('tournamentId') ?? '',
  );
  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [poolEntries, setPoolEntries] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load the event's tournaments once; seed the selection from ?tournamentId.
  useEffect(() => {
    const controller = new AbortController();
    // Tolerant, as before: an empty picker is its own empty state, and the
    // ranking panel below says when it has nothing to draw.
    void apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, {
      signal: controller.signal,
    }).then((r) => {
      const data = r.ok ? r.data : [];
      setTournaments(data);
      const urlId = searchParams.get('tournamentId') ?? '';
      const targetId = data.some((t) => t.id === urlId) ? urlId : (data[0]?.id ?? '');
      setSelectedTournament(targetId);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Mirror the selection to the URL so refresh + share both work.
  useEffect(() => {
    if (!selectedTournament || typeof window === 'undefined') return;
    if (searchParams.get('tournamentId') === selectedTournament) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tournamentId', selectedTournament);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [selectedTournament, searchParams, router]);

  // Fetch bracket + pool standings for the selected tournament.
  useEffect(() => {
    if (!selectedTournament) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear loading flag when no tournament is selected
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      apiRequest<unknown>(apiUrl, `/api/v1/tournaments/${selectedTournament}/bracket`, {
        signal: controller.signal,
      }).then((r) => (r.ok ? r.data : null)),
      apiRequest<unknown>(
        apiUrl,
        `/api/v1/tournaments/${selectedTournament}/pool-standings?mode=overall`,
        { signal: controller.signal },
      ).then((r) => (r.ok ? r.data : null)),
    ])
      .then(([bracketData, standingsData]) => {
        setBracket(
          bracketData && Array.isArray((bracketData as BracketResponse).slots)
            ? (bracketData as BracketResponse)
            : null,
        );
        const rows = (standingsData as { rows?: StandingsRow[] } | null)?.rows ?? [];
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
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedTournament, refreshKey]);

  // Live-refresh on bracket-match changes (a finished match changes the ranking).
  const bracketPhaseId = bracket?.phaseId ?? null;
  useRealtimeWithFallback({
    channelName: bracketPhaseId ? `finalranking-${bracketPhaseId}` : 'finalranking-idle',
    table: 'matches',
    filter: bracketPhaseId
      ? `phase_id=eq.${bracketPhaseId}`
      : 'phase_id=eq.00000000-0000-0000-0000-000000000000',
    event: '*',
    onEvent: () => setRefreshKey((k) => k + 1),
    onFallbackPoll: () => setRefreshKey((k) => k + 1),
  });

  const maxRound = useMemo(
    () => (bracket?.slots ?? []).reduce((m, s) => Math.max(m, s.round), 0),
    [bracket],
  );
  const ranking = useMemo<FinalRankingEntry[]>(
    () =>
      bracket
        ? computeFinalRanking(
            bracket.slots,
            poolEntries,
            bracket.bronzeSlotId,
            rankingBracketShape(bracket),
          )
        : [],
    [bracket, poolEntries],
  );

  const tournamentName =
    tournaments.find((tour) => tour.id === selectedTournament)?.name ??
    t('organizer.finalRanking.tournamentFallback');
  const exportRows = useMemo<ExportRow[]>(
    () =>
      ranking.map((entry) => ({
        rank: entry.place,
        fighter: entry.fighterName,
        club: entry.clubAbbrev ?? '',
        result: resultLabel(entry, maxRound, t),
        poolScore: entry.poolScore != null ? entry.poolScore.toFixed(2) : '',
      })),
    [ranking, maxRound, t],
  );

  function downloadCsv() {
    if (exportRows.length === 0) return;
    // BOM so Excel reads accented names as UTF-8.
    const blob = new Blob(['﻿', rankingToCsv(exportRows)], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `final-ranking-${slugify(tournamentName)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printRanking() {
    if (exportRows.length === 0) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      rankingToPrintHtml(
        t('organizer.finalRanking.printTitle', { name: tournamentName }),
        exportRows,
      ),
    );
    w.document.close();
    w.focus();
    w.print();
  }

  const canExport = !loading && ranking.length > 0;

  return (
    <main className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted">
            <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
              {slug}
            </Link>
            <span>/</span>
            <Link
              href={`/org/${slug}/events/${eventId}`}
              className="hover:text-foreground-secondary"
            >
              {t('organizer.finalRanking.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="font-medium text-foreground">{t('organizer.finalRanking.title')}</span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.finalRanking.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('organizer.finalRanking.subtitle')}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!canExport}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('organizer.schedulePage.grid.exportCsv')}
          </button>
          <button
            type="button"
            onClick={printRanking}
            disabled={!canExport}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('organizer.finalRanking.printPdf')}
          </button>
        </div>
      </div>

      {tournaments.length > 1 && (
        <nav
          aria-label={t('organizer.bracketPage.tournamentTabsLabel')}
          className="mb-4 flex flex-wrap gap-1 border-b border-border"
        >
          {tournaments.map((tour) => {
            const active = tour.id === selectedTournament;
            return (
              <button
                key={tour.id}
                type="button"
                onClick={() => setSelectedTournament(tour.id)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-accent text-accent'
                    : 'border-transparent text-foreground-secondary hover:text-foreground',
                ].join(' ')}
              >
                <TournamentColorDot color={tour.color} size="sm" />
                <span>{tour.name}</span>
              </button>
            );
          })}
        </nav>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('organizer.finalRanking.loading')}</p>
      ) : !bracket ? (
        <div className="rounded-xl border-2 border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted">{t('organizer.finalRanking.noBracket')}</p>
        </div>
      ) : ranking.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted">{t('organizer.finalRanking.emptyRanking')}</p>
        </div>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th" className="w-16 text-center">
              {t('organizer.finalRanking.colRank')}
            </DataTableCell>
            <DataTableCell as="th">{t('organizer.finalRanking.colFighter')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.finalRanking.colResult')}</DataTableCell>
            <DataTableCell as="th" className="text-right">
              {t('organizer.finalRanking.colPoolScore')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {ranking.map((entry) => (
              <DataTableRow key={entry.registrationId}>
                <DataTableCell className="text-center font-mono tabular-nums">
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    {medalFor(entry.place)}
                    {entry.place}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <span className="font-medium text-foreground">{entry.fighterName}</span>
                  {entry.clubAbbrev && (
                    <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
                      {entry.clubAbbrev}
                    </span>
                  )}
                </DataTableCell>
                <DataTableCell className="text-foreground-secondary">
                  {resultLabel(entry, maxRound, t)}
                </DataTableCell>
                <DataTableCell className="text-right font-mono tabular-nums text-foreground-secondary">
                  {entry.poolScore != null ? entry.poolScore.toFixed(2) : '—'}
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </main>
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tournament'
  );
}

function medalFor(place: number): string {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return '';
}

function resultLabel(entry: FinalRankingEntry, maxRound: number, t: Translator): string {
  switch (entry.resultKind) {
    case 'champion':
      return t('organizer.finalRanking.resultChampion');
    case 'runnerUp':
      return t('organizer.finalRanking.resultRunnerUp');
    case 'third':
      return t('organizer.finalRanking.resultThird');
    case 'fourth':
      return t('organizer.finalRanking.resultFourth');
    case 'round':
      return roundLabel(entry.eliminationRound ?? 0, maxRound, t);
    case 'pool':
      return t('organizer.finalRanking.resultPools');
    case 'swiss':
      // Placed by the Swiss standings, not eliminated in a round.
      return t('organizer.finalRanking.resultSwiss');
  }
}

/** Phase name for the round a fighter was eliminated in (deepest = Semi-finals). */
function roundLabel(round: number, maxRound: number, t: Translator): string {
  const remaining = maxRound - round;
  if (remaining <= 0) return t('organizer.finalRanking.roundFinal');
  if (remaining === 1) return t('organizer.finalRanking.roundSemis');
  if (remaining === 2) return t('organizer.finalRanking.roundQuarters');
  return t('organizer.finalRanking.roundOfN', { n: 1 << (remaining + 1) });
}
