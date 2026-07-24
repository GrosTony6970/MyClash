/**
 * Tournament stats page — T-1003
 * Route: /e/[eventSlug]/t/[tournamentSlug]/stats
 *
 * Standalone route kept for direct/bookmarked links. The tournament page now
 * also surfaces these stats as an inline "Statistics" tab; both render the
 * shared, hook-free `StatsView` — this route just wraps it in page chrome
 * (header + back-link) and resolves the tournament id from the slug.
 *
 * Note: hit_ratio is BLOW-based (mode-independent) per the data model.
 */

import type { Metadata } from 'next';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import Link from 'next/link';
import { fetchTournamentStats } from '../stats-data';
import { StatsView } from '../StatsView';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tournamentSlug } = await params;
  const t = await getServerT();
  return { title: `${t('publicApp.tournamentStats.metaTitle')} — ${tournamentSlug}` };
}

/**
 * Resolve slug → tournament id via the public standings route.
 *
 * `.../standings` is public, slug-based, and already returns the tournament
 * header including `id` (events.service.ts: `tournamentHeader`), on the draft
 * early-return path too. The sibling tournament page resolves the id exactly
 * this way (../page.tsx), so this adds no new API surface.
 */
async function fetchTournamentId(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}/standings`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tournament?: { id?: string } };
    return data.tournament?.id ?? null;
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StatsPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const t = await getServerT();
  const apiUrl = getServerApiUrl();

  const tournamentId = await fetchTournamentId(eventSlug, tournamentSlug, apiUrl);
  if (!tournamentId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📊</p>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl mb-2">
            {t('publicApp.tournamentStats.unavailable')}
          </h1>
          <Link
            href={`/e/${eventSlug}/t/${tournamentSlug}`}
            className="text-sm text-muted hover:underline"
          >
            ← {t('publicApp.tournamentStats.backToTournament')}
          </Link>
        </div>
      </main>
    );
  }

  const { overview, fighters, targets } = await fetchTournamentStats(tournamentId, apiUrl);

  return (
    <main className="px-4 py-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/e/${eventSlug}/t/${tournamentSlug}`}
            className="text-sm text-muted hover:text-foreground mb-1 inline-block"
          >
            ← {t('publicApp.tournamentStats.tournament')}
          </Link>
          <h1
            className="font-display text-2xl font-bold sm:text-3xl"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-accent)',
            }}
          >
            {t('publicApp.tournamentStats.title')}
          </h1>
        </div>
      </div>

      <StatsView
        overview={overview}
        fighters={fighters}
        targets={targets}
        accentColor="var(--event-accent, #f59e0b)"
        t={t}
      />
    </main>
  );
}
