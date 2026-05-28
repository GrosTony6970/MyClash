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
  /** Canonical round code (e.g. `LSW-P1-ML1-PA-M1`). Computed on the
   *  backend so the pool list and the scoreboard render the same
   *  identifier for the same match. `matchLabel` stays in the payload
   *  for back-compat but the UI should prefer `roundCode`. */
  roundCode: string;
  status: string;
  poolName: string;
  redName: string;
  redClub: string | null;
  blueName: string;
  blueClub: string | null;
  weapon: string;
}

function BackToPoolListButton({ slug, eventId }: { slug: string; eventId: string }) {
  return (
    <Link
      href={`/org/${slug}/events/${eventId}/pools#matches`}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {t('organizer.scoreboard.backToPoolList')}
    </Link>
  );
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
  const [summaryErrorStatus, setSummaryErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setSummaryErrorStatus(null);

    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setSummaryErrorStatus(res.status);
          return;
        }
        const data = (await res.json()) as MatchSummary;
        setSummary(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setSummaryErrorStatus(0);
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
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackToPoolListButton slug={slug} eventId={eventId} />
        <div className="text-sm text-slate-600">{t('organizer.scoreboard.loading')}</div>
      </div>
    );
  }

  if (summaryErrorStatus !== null || !summary) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackToPoolListButton slug={slug} eventId={eventId} />
        <div className="text-sm text-red-700">
          {t('organizer.scoreboard.notFound', {
            status: String(summaryErrorStatus ?? 0),
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ── Top toolbar — always visible back button ── */}
      <div className="flex items-center justify-between">
        <BackToPoolListButton slug={slug} eventId={eventId} />
        <Link
          href={`/org/${slug}/events/${eventId}/matches/${matchId}`}
          className="text-sm text-slate-700 hover:text-slate-900"
        >
          {t('organizer.scoreboard.auditLink')}
        </Link>
      </div>

      {/* ── Match header ── */}
      <header className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <Link
            href={`/org/${slug}/events/${eventId}/pools#matches`}
            className="text-slate-700 hover:text-slate-900"
          >
            {t('organizer.scoreboard.backToPool', { poolNumber: summary.poolName })}
          </Link>
        </div>

        <h1 className="text-lg font-semibold text-slate-900">
          {t('organizer.scoreboard.matchHeaderFormat', {
            // Render the canonical roundCode (backend-built); previously
            // matchLabel here was the raw `match_number_label`, which
            // produced `L1-PA-M1` for matches that the pool list showed
            // as `LSW-P1-ML1-PA-M1`. Same field, two surfaces — one code.
            matchLabel: summary.roundCode,
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
