'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TournamentColorDot } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { TournamentQueryPanel } from './TournamentQueryPanel';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
  color?: string | null;
  rulesetCode?: string | null;
  poolCount?: number;
  bracketSize?: number | null;
  eliminationType?: string | null;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
}

interface DashboardStats {
  event: EventInfo;
  totals: {
    tournaments: number;
    registeredFighters: number;
    qualifiedReferees: number;
    clubsRepresented: number;
  };
  tournaments: Array<Tournament & { fighterCount: number; assignedRefereeCount: number }>;
}

interface AIUsage {
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('fr-FR') : '-';
}

function durationDays(start: string | null, end: string | null): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

function daysUntil(start: string | null, now: number): number | null {
  const startDate = parseDate(start);
  if (!startDate) return null;
  return Math.ceil((startDate.getTime() - now) / 86_400_000);
}

export default function EventDetailPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsage | null>(null);
  const [spendCap, setSpendCap] = useState<string>('');
  const [savingCap, setSavingCap] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/dashboard-stats`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([statsRes, tourRes]) => {
        if (!statsRes.ok) throw new Error(t('organizer.eventHub.dashboard.loadError'));
        setStats((await statsRes.json()) as DashboardStats);
        if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
        setStatsError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setStatsError(err instanceof Error ? err.message : t('common.error'));
        }
      });
    return () => controller.abort();
  }, [eventId, apiUrl, t]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const orgRes = await fetch(`${apiUrl}/api/v1/organizations/slug/${slug}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!orgRes.ok) return;
        const orgData = (await orgRes.json()) as { id: string };

        const aiRes = await fetch(`${apiUrl}/api/v1/organizations/${orgData.id}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as {
            provider: string;
            hasKey: boolean;
            updatedAt: string;
          } | null;
          if (aiData !== null) setAiEnabled(true);
        }

        const usageRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (usageRes.ok) {
          const usageData = (await usageRes.json()) as AIUsage;
          setAiUsage(usageData);
          setSpendCap(String(usageData.cap ?? ''));
        }
      } catch {
        // AI status is optional on this dashboard.
      }
    })();
    return () => controller.abort();
  }, [slug, eventId, apiUrl]);

  async function handleSaveCap() {
    if (!eventId) return;
    setSavingCap(true);
    try {
      await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          aiSpendCapEur: (() => {
            const parsed = parseFloat(spendCap);
            return spendCap === '' || isNaN(parsed) ? null : parsed;
          })(),
        }),
      });
      const response = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
        credentials: 'include',
      });
      if (response.ok) setAiUsage((await response.json()) as AIUsage);
    } catch {
      // Keep the previous budget value visible.
    } finally {
      setSavingCap(false);
    }
  }

  const event = stats?.event;
  const startDelta = useMemo(
    () => (now > 0 ? daysUntil(event?.startDate ?? null, now) : null),
    [event, now],
  );
  const liveState =
    event?.status === 'completed'
      ? t('organizer.eventHub.dashboard.completed')
      : event?.status === 'running'
        ? t('organizer.eventHub.dashboard.live')
        : startDelta === null
          ? '-'
          : startDelta > 0
            ? t('organizer.eventHub.dashboard.daysUntil', { count: startDelta })
            : startDelta === 0
              ? t('organizer.eventHub.dashboard.startsToday')
              : t('organizer.eventHub.dashboard.startedAgo', { count: Math.abs(startDelta) });

  return (
    <main className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href={`/org/${slug}`} className="hover:text-[#1d4ed8]">
              {t('organizer.eventHub.backToOrg')}
            </Link>
            <span>/</span>
            <span className="font-medium text-[#0f172a]">{event?.name ?? eventId}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[#0f172a]">{event?.name ?? eventId}</h1>
          {event && (
            <p className="mt-1 text-sm text-slate-500">
              {event.location ? `${event.location} - ` : ''}
              {formatDate(event.startDate)}
              {event.startDate !== event.endDate ? ` - ${formatDate(event.endDate)}` : ''}
            </p>
          )}
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {event?.status ?? 'event'}
        </span>
      </div>

      {statsError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {statsError}
        </div>
      )}

      <section className="mb-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              {t('organizer.eventHub.dashboard.title')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t('organizer.eventHub.dashboard.description')}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('organizer.eventHub.dashboard.dates')}
            value={`${formatDate(event?.startDate ?? null)} - ${formatDate(event?.endDate ?? null)}`}
            detail={t('organizer.eventHub.dashboard.duration', {
              count: durationDays(event?.startDate ?? null, event?.endDate ?? null),
            })}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.countdown')}
            value={liveState}
            detail={t('organizer.eventHub.dashboard.visibility', {
              status: event?.status ?? '-',
            })}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.tournaments')}
            value={String(stats?.totals.tournaments ?? 0)}
            detail={t('organizer.eventHub.dashboard.fighters', {
              count: stats?.totals.registeredFighters ?? 0,
            })}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.clubs')}
            value={String(stats?.totals.clubsRepresented ?? 0)}
            detail={t('organizer.eventHub.dashboard.referees', {
              count: stats?.totals.qualifiedReferees ?? 0,
            })}
          />
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.tournament')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.registered')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.assignedReferees')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colPools')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colBracket')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colElim')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colRuleset')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.tournaments ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    {t('organizer.eventHub.dashboard.noTournaments')}
                  </td>
                </tr>
              )}
              {(stats?.tournaments ?? []).map((tournament) => (
                <tr key={tournament.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-[#0f172a]">
                    <span className="inline-flex items-center gap-1.5">
                      <TournamentColorDot color={tournament.color} />
                      {tournament.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{tournament.fighterCount}</td>
                  <td className="px-4 py-3 text-slate-700">{tournament.assignedRefereeCount}</td>
                  <td className="px-4 py-3 text-slate-700">{tournament.poolCount ?? 0}</td>
                  <td className="px-4 py-3 text-slate-700">{tournament.bracketSize ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {tournament.eliminationType === 'single_elim'
                      ? t('organizer.eventHub.dashboard.elimSingle')
                      : tournament.eliminationType === 'double_elim'
                        ? t('organizer.eventHub.dashboard.elimDouble')
                        : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {tournament.rulesetCode ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{tournament.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {aiEnabled && <TournamentQueryPanel apiUrl={apiUrl} tournaments={tournaments} />}

      {aiEnabled && (
        <section className="mb-8 rounded-lg border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setBudgetOpen(!budgetOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-bold uppercase tracking-[0.16em] text-slate-500"
          >
            <span>{t('organizer.eventHub.aiBudget')}</span>
            <span className="text-slate-400">{budgetOpen ? 'UP' : 'DOWN'}</span>
          </button>

          {budgetOpen && (
            <div className="space-y-4 border-t border-slate-100 px-5 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1" htmlFor="aiSpendCap">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">
                    {t('organizer.eventHub.spendCap')}
                  </span>
                  <input
                    id="aiSpendCap"
                    type="number"
                    aria-label={t('organizer.eventHub.spendCap')}
                    min="0"
                    step="0.01"
                    value={spendCap}
                    onChange={(e) => setSpendCap(e.target.value)}
                    placeholder={t('organizer.eventHub.noCap')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleSaveCap()}
                  disabled={savingCap}
                  className="rounded-md bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {savingCap ? t('organizer.eventHub.saving') : t('organizer.eventHub.save')}
                </button>
              </div>

              {aiUsage && (
                <div>
                  {aiUsage.cap !== null ? (
                    <>
                      <p className="mb-1 text-sm text-slate-600">
                        {t('organizer.eventHub.budgetUsed', {
                          spent: aiUsage.totalSpendEur.toFixed(2),
                          cap: aiUsage.cap.toFixed(2),
                        })}
                      </p>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#dc2626] transition-all"
                          style={{
                            width: `${Math.min(100, (aiUsage.totalSpendEur / aiUsage.cap) * 100)}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {t('organizer.eventHub.budgetNoCap', {
                        spent: aiUsage.totalSpendEur.toFixed(2),
                        calls: aiUsage.callCount,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('organizer.eventHub.archiveTitle')}
        </h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">{t('organizer.archive.description')}</p>
            <Link
              href={`/org/${slug}/events/${eventId}/archive`}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#dc2626] hover:bg-red-100"
            >
              {t('organizer.archive.open')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[#0f172a]">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
