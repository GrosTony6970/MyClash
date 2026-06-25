'use client';

/* eslint-disable myclash/no-literal-string */

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
import { TournamentColorDot } from '@myclash/ui';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import {
  computeFinalRanking,
  type FinalRankingEntry,
  type PoolEntry,
  type RankingSlot,
} from './compute-final-ranking';

interface Tournament {
  id: string;
  name: string;
  color?: string | null;
}

interface BracketResponse {
  phaseId?: string;
  phaseType?: string;
  bronzeSlotId?: string | null;
  slots: RankingSlot[];
}

interface StandingsRow {
  registrationId: string;
  displayName: string;
  club: { name: string; abbreviation: string | null } | null;
  stats: Record<string, number | string>;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function FinalRankingPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const searchParams = useSearchParams();

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
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Tournament[]) => {
        setTournaments(data);
        const urlId = searchParams.get('tournamentId') ?? '';
        const targetId = data.some((t) => t.id === urlId) ? urlId : (data[0]?.id ?? '');
        setSelectedTournament(targetId);
      })
      .catch(() => undefined);
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
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/bracket`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/pool-standings?mode=overall`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
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
    () => (bracket ? computeFinalRanking(bracket.slots, poolEntries, bracket.bronzeSlotId) : []),
    [bracket, poolEntries],
  );

  return (
    <main className="px-4 py-6">
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-sm text-gray-500">
          <Link href={`/org/${slug}`} className="hover:text-gray-700">
            {slug}
          </Link>
          <span>/</span>
          <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
            Event
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-900">Final ranking</span>
        </div>
        <h1 className="text-2xl font-bold">Final ranking</h1>
        <p className="mt-1 text-sm text-gray-500">
          Bracket placement — fighters eliminated in the same round are separated by their pool
          score.
        </p>
      </div>

      {tournaments.length > 1 && (
        <nav
          aria-label="Tournaments"
          className="mb-4 flex flex-wrap gap-1 border-b border-slate-200"
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
                    ? 'border-red-800 text-red-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900',
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
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !bracket ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-400">No bracket for this tournament yet.</p>
        </div>
      ) : ranking.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-400">
            The final ranking appears once bracket matches are played.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-16 px-4 py-2 text-center">Rank</th>
                <th className="px-4 py-2">Fighter</th>
                <th className="px-4 py-2">Result</th>
                <th className="px-4 py-2 text-right">Pool score</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((entry) => (
                <tr
                  key={entry.registrationId}
                  className="border-b border-gray-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-2 text-center font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                      {medalFor(entry.place)}
                      {entry.place}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-900">{entry.fighterName}</span>
                    {entry.clubAbbrev && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {entry.clubAbbrev}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{resultLabel(entry, maxRound)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                    {entry.poolScore != null ? entry.poolScore.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
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
      return 'Champion';
    case 'runnerUp':
      return 'Runner-up';
    case 'third':
      return '3rd place';
    case 'fourth':
      return '4th place';
    case 'round':
      return roundLabel(entry.eliminationRound ?? 0, maxRound);
    case 'pool':
      return 'Pools';
  }
}

/** Phase name for the round a fighter was eliminated in (deepest = Semi-finals). */
function roundLabel(round: number, maxRound: number): string {
  const remaining = maxRound - round;
  if (remaining <= 0) return 'Final';
  if (remaining === 1) return 'Semi-finals';
  if (remaining === 2) return 'Quarter-finals';
  return `Round of ${1 << (remaining + 1)}`;
}
