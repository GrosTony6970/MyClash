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
import { useParams } from 'next/navigation';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  TournamentColorDot,
  useToast,
  computeFinalRanking,
  rankingBracketShape,
  type FinalRankingEntry,
} from '@myclash/ui';
import { rankingToCsv, rankingToPrintHtml, type ExportRow } from './final-ranking-export';
import { useFinalRankingData } from './useFinalRankingData';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { openPrintWindow } from '@/lib/print-window';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';

type Translator = (key: string, values?: Record<string, string | number>) => string;

interface Tournament {
  id: string;
  name: string;
  color?: string | null;
}

const apiUrl = getPublicApiUrl();

export default function FinalRankingPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const { t } = useI18n();
  const toast = useToast();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useTournamentChoice(
    eventId,
    tournaments.map((tour) => tour.id),
  );

  useEffect(() => {
    const controller = new AbortController();
    // Tolerant, as before: an empty picker is its own empty state, and the
    // ranking panel below says when it has nothing to draw.
    void apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, {
      signal: controller.signal,
    }).then((r) => setTournaments(r.ok ? r.data : []));
    return () => controller.abort();
  }, [eventId]);

  const { bracket, poolEntries, loading } = useFinalRankingData(selectedTournament);

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
    openPrintWindow(
      rankingToPrintHtml(
        t('organizer.finalRanking.printTitle', { name: tournamentName }),
        exportRows,
      ),
      () => toast.error(t('organizer.printWindow.popupBlocked')),
    );
  }

  const canExport = !loading && ranking.length > 0;

  return (
    <main className="mx-auto max-w-[110rem] px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted">
            <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
            <span>/</span>
            <EventCrumb
              slug={slug}
              eventId={eventId}
              className="hover:text-foreground-secondary"
              fallback={t('organizer.finalRanking.breadcrumbEvent')}
            />
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
