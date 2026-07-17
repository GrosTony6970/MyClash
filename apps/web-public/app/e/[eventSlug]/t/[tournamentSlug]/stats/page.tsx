/**
 * Tournament stats page — T-1003
 * Route: /e/[eventSlug]/t/[tournamentSlug]/stats
 *
 * Reproduces the lyonamhe.fr/resultat_fal2026.html layout:
 *   - Overview hero numbers
 *   - Per-fighter detailed table (Dbl / ✓1 / ✓1-1 / ✓2 / ✓2-1 / ✗1 / ✗1-1 / ✗2 / ✗2-1 / Total / Ratio)
 *   - Distribution chart (exchange types)
 *   - Double-rate evolution (top doubles fighters)
 *   - Top 5 blow-ratio fighters
 *
 * Note: hit_ratio is BLOW-based (mode-independent) per the data model.
 * point_ratio is also available for scoring-based ranking.
 */

import type { Metadata } from 'next';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import Link from 'next/link';

interface Props {
  params: Promise<{ eventSlug: string; tournamentSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tournamentSlug } = await params;
  const t = await getServerT();
  return { title: `${t('publicApp.tournamentStats.metaTitle')} — ${tournamentSlug}` };
}

// ── API types ─────────────────────────────────────────────────────────────────

interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  hitsGiven1: number;
  afterblowGiven1: number;
  hitsGiven2: number;
  afterblowGiven2: number;
  hitsGiven3: number;
  afterblowGiven3: number;
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
  hitsReceived3: number;
  afterblowReceived3: number;
  blowsGiven: number;
  blowsReceived: number;
  afterblowsReceivedTotal: number;
  pointsGiven: number;
  pointsReceived: number;
  totalExchanges: number;
  hitRatio: number | null;
  pointRatio: number | null;
}

interface Overview {
  tournamentId: string;
  participantCount: number;
  matchCount: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
  topFighters: Array<{
    name: string;
    club: string | null;
    hitRatio: number | null;
    blowsGiven: number;
    blowsReceived: number;
  }>;
}

interface TargetValueStats {
  maxValue: number | null;
  distribution: Array<{ value: number; cleanHits: number }>;
  hunters: Array<{ personId: string; name: string; club: string | null; cleanHits: number }>;
}

const EMPTY_TARGETS: TargetValueStats = { maxValue: null, distribution: [], hunters: [] };

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchStats(
  tournamentId: string,
  apiUrl: string,
): Promise<{ overview: Overview | null; fighters: FighterStats[]; targets: TargetValueStats }> {
  try {
    const [overviewRes, fightersRes, targetsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/stats/overview`, {
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/stats/fighters`, {
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/stats/target-values`, {
        cache: 'no-store',
      }),
    ]);

    const overview = overviewRes.ok ? ((await overviewRes.json()) as Overview) : null;
    const fighters = fightersRes.ok ? ((await fightersRes.json()) as FighterStats[]) : [];
    const targets = targetsRes.ok ? ((await targetsRes.json()) as TargetValueStats) : EMPTY_TARGETS;

    return { overview, fighters, targets };
  } catch {
    return { overview: null, fighters: [], targets: EMPTY_TARGETS };
  }
}

/**
 * Resolve slug → tournament id via the public standings route.
 *
 * This used to GET `events/:eventSlug/tournaments/:tournamentSlug`, which has
 * never existed — so it 404'd, this returned null, and the guard clause below
 * short-circuited the whole page to "stats unavailable". Every visitor, always,
 * since the page was written; the 400 lines of stats UI under it never ran.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return String(n);
}

function fmtRatio(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(3);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
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

  const { overview, fighters, targets } = await fetchStats(tournamentId, apiUrl);

  // Sort fighters by hit_ratio desc (blow-based, mode-independent)
  const sorted = [...fighters].sort((a, b) => (b.hitRatio ?? -1) - (a.hitRatio ?? -1));

  // Show value-3 columns only when the ruleset produced 3-pt hits (migration 0136).
  const hasV3 = fighters.some(
    (f) => f.hitsGiven3 + f.afterblowGiven3 + f.hitsReceived3 + f.afterblowReceived3 > 0,
  );

  // Point-value distribution (1pt/2pt/3pt) for the stacked bar.
  const targetTotal = targets.distribution.reduce((s, d) => s + d.cleanHits, 0);
  const DIST_COLORS = ['bg-amber-600', 'bg-red-800', 'bg-purple-700', 'bg-emerald-700'];

  // Exchange type distribution
  const totalClean = fighters.reduce((s, f) => s + f.hitsGiven1 + f.hitsGiven2, 0) / 2; // each exchange counted twice (attacker + defender)
  const totalAfterblows =
    fighters.reduce((s, f) => s + f.afterblowGiven1 + f.afterblowGiven2, 0) / 2;
  const totalDoubles = overview?.doublesCount ?? 0;
  const totalEx = overview?.exchangeCount ?? 1;

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

      {/* ── Hero numbers ── */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-4">
          {[
            {
              label: t('publicApp.tournamentStats.heroParticipants'),
              value: overview.participantCount,
            },
            { label: t('publicApp.tournamentStats.heroMatches'), value: overview.matchCount },
            { label: t('publicApp.tournamentStats.heroExchanges'), value: overview.exchangeCount },
            {
              label: t('publicApp.tournamentStats.heroDoubles'),
              value: `${overview.doublesCount} (${overview.doublesPercent}%)`,
            },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface border border-border rounded-xl p-4 text-center">
              <p className="text-2xl font-black text-foreground">{value}</p>
              <p className="text-xs text-muted mt-0.5 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Exchange distribution ── */}
      {overview && overview.exchangeCount > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.tournamentStats.exchangeDistribution')}
          </h2>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="flex gap-1 h-8 rounded-lg overflow-hidden mb-2">
              {[
                {
                  n: totalClean,
                  color: 'bg-green-700',
                  label: t('publicApp.tournamentStats.exchangeClean'),
                },
                {
                  n: totalAfterblows,
                  color: 'bg-orange-700',
                  label: t('publicApp.tournamentStats.exchangeAfterblow'),
                },
                {
                  n: totalDoubles,
                  color: 'bg-red-800',
                  label: t('publicApp.tournamentStats.exchangeDouble'),
                },
              ].map(({ n, color }) => (
                <div
                  key={color}
                  className={`${color} transition-all`}
                  style={{ width: `${(n / totalEx) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex gap-4 text-xs text-muted">
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-green-700 mr-1" />
                {t('publicApp.tournamentStats.exchangeClean')} {pct(totalClean, totalEx)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-orange-700 mr-1" />
                {t('publicApp.tournamentStats.exchangeAfterblow')} {pct(totalAfterblows, totalEx)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-red-800 mr-1" />
                {t('publicApp.tournamentStats.exchangeDouble')} {pct(totalDoubles, totalEx)}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ── Top 5 by blow ratio ── */}
      {overview && overview.topFighters.length > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.tournamentStats.topFightersTitle')}
          </h2>
          <div className="flex flex-col gap-2">
            {overview.topFighters.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3"
              >
                <span className="text-muted font-bold w-5 text-right text-sm">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-semibold text-foreground text-sm">{f.name}</p>
                  {f.club && <p className="text-xs text-muted">{f.club}</p>}
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-foreground">{fmtRatio(f.hitRatio)}</p>
                  <p className="text-xs text-muted">
                    {f.blowsGiven}↑ {f.blowsReceived}↓
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">
            {t('publicApp.tournamentStats.topFightersCaption')}
          </p>
        </section>
      )}

      {/* ── Deep-target hunters ── */}
      {targets.hunters.length > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.tournamentStats.deepTargetsTitle')}
          </h2>
          <p className="text-xs text-muted mb-3">
            {t('publicApp.tournamentStats.deepTargetsCaption', { points: targets.maxValue ?? 0 })}
          </p>
          <div className="flex flex-col gap-2">
            {targets.hunters.map((h, i) => (
              <div
                key={h.personId}
                className="flex items-center gap-3 bg-surface border border-border rounded-xl px-4 py-3"
              >
                <span className="text-muted font-bold w-5 text-right text-sm">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-semibold text-foreground text-sm">{h.name}</p>
                  {h.club && <p className="text-xs text-muted">{h.club}</p>}
                </div>
                <p className="font-mono font-bold text-foreground">{h.cleanHits}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Target zones (1pt / 2pt / 3pt distribution) ── */}
      {targetTotal > 0 && (
        <section className="mb-8">
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.tournamentStats.pointDistributionTitle')}
          </h2>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="flex gap-1 h-8 rounded-lg overflow-hidden mb-2">
              {targets.distribution.map((d, i) => (
                <div
                  key={d.value}
                  className={`${DIST_COLORS[i % DIST_COLORS.length]} transition-all`}
                  style={{ width: `${(d.cleanHits / targetTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              {targets.distribution.map((d, i) => (
                <span key={d.value}>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${DIST_COLORS[i % DIST_COLORS.length]} mr-1`}
                  />
                  {t('publicApp.tournamentStats.pointDistributionSegment', { points: d.value })}{' '}
                  {pct(d.cleanHits, targetTotal)}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Per-fighter detailed table ── */}
      {sorted.length > 0 && (
        <section>
          <h2
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            {t('publicApp.tournamentStats.detailedStats')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="text-left py-2 pr-3 font-medium">
                    {t('publicApp.tournamentStats.colFighter')}
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium"
                    title={t('publicApp.tournamentStats.colDoublesTitle')}
                  >
                    {t('publicApp.tournamentStats.colDoubles')}
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-green-700"
                    title={t('publicApp.tournamentStats.colClean1GivenTitle')}
                  >
                    ✓1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-orange-600"
                    title={t('publicApp.tournamentStats.colAfterblow1GivenTitle')}
                  >
                    ✓1-1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-green-700"
                    title={t('publicApp.tournamentStats.colClean2GivenTitle')}
                  >
                    ✓2
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-orange-600"
                    title={t('publicApp.tournamentStats.colAfterblow2GivenTitle')}
                  >
                    ✓2-1
                  </th>
                  {hasV3 && (
                    <>
                      <th className="text-center py-2 px-1.5 font-medium text-green-700">✓3</th>
                      <th className="text-center py-2 px-1.5 font-medium text-orange-600">✓3-1</th>
                    </>
                  )}
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-600"
                    title={t('publicApp.tournamentStats.colClean1ReceivedTitle')}
                  >
                    ✗1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-400"
                    title={t('publicApp.tournamentStats.colAfterblow1ReceivedTitle')}
                  >
                    ✗1-1
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-600"
                    title={t('publicApp.tournamentStats.colClean2ReceivedTitle')}
                  >
                    ✗2
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium text-red-400"
                    title={t('publicApp.tournamentStats.colAfterblow2ReceivedTitle')}
                  >
                    ✗2-1
                  </th>
                  {hasV3 && (
                    <>
                      <th className="text-center py-2 px-1.5 font-medium text-red-600">✗3</th>
                      <th className="text-center py-2 px-1.5 font-medium text-red-400">✗3-1</th>
                    </>
                  )}
                  <th
                    className="text-center py-2 px-1.5 font-medium"
                    title={t('publicApp.tournamentStats.colTotalTitle')}
                  >
                    {t('publicApp.tournamentStats.colTotal')}
                  </th>
                  <th
                    className="text-center py-2 px-1.5 font-medium"
                    title={t('publicApp.tournamentStats.colDoublePctTitle')}
                  >
                    {t('publicApp.tournamentStats.colDoublePct')}
                  </th>
                  <th
                    className="text-right py-2 pl-2 font-medium"
                    title={t('publicApp.tournamentStats.colRatioTitle')}
                  >
                    {t('publicApp.tournamentStats.colRatio')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f, idx) => (
                  <tr
                    key={f.registrationId}
                    className={[
                      'border-b border-border/60',
                      idx === 0 ? 'font-medium text-foreground' : 'text-foreground',
                    ].join(' ')}
                  >
                    <td className="py-2 pr-3">
                      <p className="font-medium leading-tight">
                        {f.givenName} {f.familyName}
                      </p>
                      {f.clubName && <p className="text-muted text-xs">{f.clubName}</p>}
                    </td>
                    <td className="text-center py-2 px-1.5">{fmt(f.doubles)}</td>
                    <td className="text-center py-2 px-1.5 text-green-700">{fmt(f.hitsGiven1)}</td>
                    <td className="text-center py-2 px-1.5 text-orange-600">
                      {fmt(f.afterblowGiven1)}
                    </td>
                    <td className="text-center py-2 px-1.5 text-green-700">{fmt(f.hitsGiven2)}</td>
                    <td className="text-center py-2 px-1.5 text-orange-600">
                      {fmt(f.afterblowGiven2)}
                    </td>
                    {hasV3 && (
                      <>
                        <td className="text-center py-2 px-1.5 text-green-700">
                          {fmt(f.hitsGiven3)}
                        </td>
                        <td className="text-center py-2 px-1.5 text-orange-600">
                          {fmt(f.afterblowGiven3)}
                        </td>
                      </>
                    )}
                    <td className="text-center py-2 px-1.5 text-red-600">{fmt(f.hitsReceived1)}</td>
                    <td
                      className="text-center py-2 px-1.5 text-red-400"
                      title={t('publicApp.tournamentStats.blowAlwaysCountedTitle')}
                    >
                      {fmt(f.afterblowReceived1)}
                    </td>
                    <td className="text-center py-2 px-1.5 text-red-600">{fmt(f.hitsReceived2)}</td>
                    <td
                      className="text-center py-2 px-1.5 text-red-400"
                      title={t('publicApp.tournamentStats.blowAlwaysCountedTitle')}
                    >
                      {fmt(f.afterblowReceived2)}
                    </td>
                    {hasV3 && (
                      <>
                        <td className="text-center py-2 px-1.5 text-red-600">
                          {fmt(f.hitsReceived3)}
                        </td>
                        <td className="text-center py-2 px-1.5 text-red-400">
                          {fmt(f.afterblowReceived3)}
                        </td>
                      </>
                    )}
                    <td className="text-center py-2 px-1.5">{fmt(f.totalExchanges)}</td>
                    <td className="text-center py-2 px-1.5">
                      {f.totalExchanges > 0
                        ? `${Math.round((f.doubles / f.totalExchanges) * 100)}%`
                        : '0%'}
                    </td>
                    <td className="text-right py-2 pl-2 font-mono font-bold">
                      {fmtRatio(f.hitRatio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">
            {t('publicApp.tournamentStats.detailedStatsCaption')}
          </p>
        </section>
      )}

      {fighters.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-muted text-sm">{t('publicApp.tournamentStats.emptyState')}</p>
        </div>
      )}
    </main>
  );
}
