'use client';

/**
 * Scoreboard page for pool matches — Task 2
 * Route: /org/[slug]/events/[eventId]/matches/[matchId]/scoreboard
 *
 * Renders the shared MatchScoreboard component below a compact match header.
 * Fetches header data from GET /api/v1/matches/{matchId}/summary (Option B).
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { MatchScoreboard } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatchSummary {
  matchLabel: string;
  status: string;
  poolName: string;
  redName: string;
  redClub: string | null;
  blueName: string;
  blueClub: string | null;
  weapon: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ScoreboardPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string; matchId: string }>;
}) {
  const { slug, eventId, matchId } = use(params);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setNotFoundError(false);

    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFoundError(true);
          return;
        }
        if (!res.ok) {
          setNotFoundError(true);
          return;
        }
        const data = (await res.json()) as MatchSummary;
        setSummary(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setNotFoundError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [matchId, apiUrl]);

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-600">{t('organizer.scoreboard.loading')}</div>;
  }

  if (notFoundError || !summary) {
    return <div className="p-6 text-sm text-red-700">{t('organizer.scoreboard.notFound')}</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ── Match header ── */}
      <header className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <Link
            href={`/org/${slug}/events/${eventId}/pools?tab=matches`}
            className="text-slate-700 hover:text-slate-900"
          >
            {t('organizer.scoreboard.backToPool', { poolNumber: summary.poolName })}
          </Link>
          <Link
            href={`/org/${slug}/events/${eventId}/matches/${matchId}`}
            className="text-slate-700 hover:text-slate-900"
          >
            {t('organizer.scoreboard.auditLink')}
          </Link>
        </div>

        <h1 className="text-lg font-semibold text-slate-900">
          {t('organizer.scoreboard.matchHeaderFormat', {
            matchLabel: summary.matchLabel,
            poolNumber: summary.poolName,
            weapon: summary.weapon,
          })}
        </h1>

        <div className="mt-1 text-sm text-slate-700">
          {summary.redName}
          {summary.redClub ? ` (${summary.redClub})` : ''} {t('organizer.scoreboard.vs')}{' '}
          {summary.blueName}
          {summary.blueClub ? ` (${summary.blueClub})` : ''}
        </div>
      </header>

      {/* ── Realtime scoreboard ── */}
      <MatchScoreboard
        matchId={matchId}
        apiBaseUrl={apiUrl}
        supabaseClient={getSupabaseBrowser()}
        showNextMatch={false}
        className="rounded-lg border border-slate-200 bg-white"
      />
    </div>
  );
}
