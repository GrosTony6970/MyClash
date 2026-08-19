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
import { getServerT } from '@myclash/next-i18n/server';
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
 * Resolve slug → the tournament's id and colour token via the public standings route.
 *
 * `.../standings` is public, slug-based, and already returns the tournament
 * header including `id` AND `color` (events.service.ts: `tournamentHeader`), on
 * the draft early-return path too. The sibling tournament page resolves it
 * exactly this way (../page.tsx), so this adds no new API surface — the colour
 * was already in this response, merely dropped by the parse.
 */
async function fetchTournamentHeader(
  eventSlug: string,
  tournamentSlug: string,
  apiUrl: string,
): Promise<{ id: string; colorToken: string | null } | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventSlug}/tournaments/${tournamentSlug}/standings`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tournament?: { id?: string; color?: string | null } };
    const id = data.tournament?.id;
    if (!id) return null;
    return { id, colorToken: data.tournament?.color ?? null };
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StatsPage({ params }: Props) {
  const { eventSlug, tournamentSlug } = await params;
  const t = await getServerT();
  const apiUrl = getServerApiUrl();

  const header = await fetchTournamentHeader(eventSlug, tournamentSlug, apiUrl);
  if (!header) {
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

  const { overview, fighters, targets } = await fetchTournamentStats(header.id, apiUrl);

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
        colorToken={header.colorToken}
        t={t}
      />
    </main>
  );
}
