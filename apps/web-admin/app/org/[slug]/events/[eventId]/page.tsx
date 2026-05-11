/* eslint-disable myclash/no-literal-string */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

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
  const [, setTournaments] = useState<Tournament[]>([]);

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
        // 1. Fetch org ID from slug
        const orgRes = await fetch(`${apiUrl}/api/v1/organizations/slug/${slug}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!orgRes.ok) return;
        const orgData = (await orgRes.json()) as { id: string };

        // 2. Fetch AI settings
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

        // 3. Fetch AI usage
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
        // silent
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
      // Re-fetch usage to update meter
      const r = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
        credentials: 'include',
      });
      if (r.ok) setAiUsage((await r.json()) as AIUsage);
    } catch {
      // silent
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
    {
      label: t('organizer.eventHub.sections.compensation'),
      href: 'compensation',
      icon: '€',
    },
    { label: t('organizer.eventHub.sections.workshops'), href: 'workshops', icon: 'W' },
    { label: t('organizer.eventHub.sections.staff'), href: 'staff', icon: 'S' },
    { label: t('organizer.eventHub.sections.notifications'), href: 'notifications', icon: 'N' },
    { label: t('organizer.eventHub.sections.aiAssistant'), href: 'ai-assistant', icon: 'AI' },
    { label: t('organizer.eventHub.sections.theme'), href: 'theme', icon: 'T' },
    { label: t('admin.dashboard.leaguesTitle'), href: 'leagues', icon: 'L' },
    { label: t('organizer.archive.navLabel'), href: 'archive', icon: 'A' },
  ];

  return (
    <main className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{event?.name ?? eventId}</span>
      </div>

      {event && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {event.location ? `${event.location} - ` : ''}
            {new Date(event.startDate).toLocaleDateString('fr-FR')}
            {event.startDate !== event.endDate
              ? ` - ${new Date(event.endDate).toLocaleDateString('fr-FR')}`
              : ''}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={`/org/${slug}/events/${eventId}/${section.href}`}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-red-300 hover:shadow-sm transition-all"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600">
              {section.icon}
            </span>
            <span className="text-sm font-medium text-gray-700">{section.label}</span>
          </Link>
        ))}
      </div>

      {aiEnabled && (
        <section className="mb-8">
          <button
            onClick={() => setBudgetOpen(!budgetOpen)}
            className="flex items-center justify-between w-full text-sm font-bold uppercase tracking-wide text-gray-500 mb-3"
          >
            <span>AI Budget</span>
            <span className="text-gray-400">{budgetOpen ? '▲' : '▼'}</span>
          </button>

          {budgetOpen && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              {/* Spend cap input */}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Spend cap (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendCap}
                    onChange={(e) => setSpendCap(e.target.value)}
                    placeholder="No cap"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <button
                  onClick={() => void handleSaveCap()}
                  disabled={savingCap}
                  className="px-4 py-2 bg-red-700 text-white text-sm font-medium rounded-lg hover:bg-red-800 disabled:opacity-50"
                >
                  {savingCap ? 'Saving…' : 'Save'}
                </button>
              </div>

              {/* Spend meter */}
              {aiUsage && (
                <div>
                  {aiUsage.cap !== null ? (
                    <>
                      <p className="text-sm text-gray-600 mb-1">
                        €{aiUsage.totalSpendEur.toFixed(2)} used of €{aiUsage.cap.toFixed(2)} cap
                      </p>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (aiUsage.totalSpendEur / aiUsage.cap) * 100)}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No cap set — €{aiUsage.totalSpendEur.toFixed(2)} spent ({aiUsage.callCount}{' '}
                      calls)
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          {t('organizer.archive.title')}
        </h2>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-gray-600">{t('organizer.archive.description')}</p>
            <Link
              href={`/org/${slug}/events/${eventId}/archive`}
              className="text-sm font-medium text-red-700 hover:underline flex-shrink-0"
            >
              {t('organizer.archive.open')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
