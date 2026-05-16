'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { TournamentQueryPanel } from './TournamentQueryPanel';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string;
  endDate: string;
  location: string | null;
}

interface AIUsage {
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}

export default function EventDetailPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsage | null>(null);
  const [spendCap, setSpendCap] = useState<string>('');
  const [savingCap, setSavingCap] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([evRes, tourRes]) => {
        if (evRes.ok) setEvent((await evRes.json()) as EventInfo);
        if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

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
          if (aiData !== null) {
            setAiEnabled(true);
          }
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
            const p = parseFloat(spendCap);
            return spendCap === '' || isNaN(p) ? null : p;
          })(),
        }),
      });
      const r = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
        credentials: 'include',
      });
      if (r.ok) setAiUsage((await r.json()) as AIUsage);
    } catch {
      // Keep the previous budget value visible.
    } finally {
      setSavingCap(false);
    }
  }

  const sections = [
    { label: t('organizer.eventHub.sections.persons'), href: 'persons', icon: 'P' },
    { label: t('organizer.eventHub.sections.registrations'), href: 'registrations', icon: 'R' },
    { label: t('organizer.eventHub.sections.pools'), href: 'pools', icon: 'P' },
    { label: t('organizer.eventHub.sections.poolPopulator'), href: 'pool-populator', icon: 'G' },
    { label: t('organizer.eventHub.sections.bracket'), href: 'bracket', icon: 'B' },
    { label: t('organizer.eventHub.sections.schedule'), href: 'schedule', icon: 'S' },
    { label: t('organizer.eventHub.sections.referees'), href: 'referees', icon: 'J' },
    {
      label: t('organizer.eventHub.sections.refereeAssignments'),
      href: 'referee-assignments',
      icon: 'A',
    },
    { label: t('organizer.eventHub.sections.compensation'), href: 'compensation', icon: 'C' },
    { label: t('organizer.eventHub.sections.workshops'), href: 'workshops', icon: 'W' },
    { label: t('organizer.eventHub.sections.staff'), href: 'staff', icon: 'ST' },
    { label: t('organizer.eventHub.sections.notifications'), href: 'notifications', icon: 'N' },
    { label: t('organizer.eventHub.sections.aiAssistant'), href: 'ai-assistant', icon: 'AI' },
    { label: t('organizer.eventHub.sections.theme'), href: 'theme', icon: 'T' },
    { label: t('admin.dashboard.leaguesTitle'), href: 'leagues', icon: 'L' },
    { label: t('organizer.archive.navLabel'), href: 'archive', icon: 'A' },
  ];

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
              {new Date(event.startDate).toLocaleDateString('fr-FR')}
              {event.startDate !== event.endDate
                ? ` - ${new Date(event.endDate).toLocaleDateString('fr-FR')}`
                : ''}
            </p>
          )}
        </div>
        <span className="w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {event?.status ?? 'event'}
        </span>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={`/org/${slug}/events/${eventId}/${section.href}`}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:border-[#1d4ed8]/40 hover:shadow-md"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[0.65rem] font-bold text-[#f59e0b]">
              {section.icon}
            </span>
            <span className="text-sm font-semibold text-[#0f172a]">{section.label}</span>
          </Link>
        ))}
      </div>

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
              className="text-sm font-semibold text-[#dc2626] hover:underline"
            >
              {t('organizer.archive.open')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
