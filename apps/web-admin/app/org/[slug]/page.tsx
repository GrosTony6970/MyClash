'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { AdminPageHeader, MetricCard, StatsGrid } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { useOrganizerSelectedEvent } from '../../../src/components/organizer-event-context';
import { ColorSwatchPicker } from '../../../src/components/ColorSwatchPicker';

interface DashboardStats {
  eventsTotal: number;
  upcomingEvents: number;
  tournamentsTotal: number;
  fighterParticipations: number;
  refereeParticipations: number;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColor: string | null;
}

const EMPTY_STATS: DashboardStats = {
  eventsTotal: 0,
  upcomingEvents: 0,
  tournamentsTotal: 0,
  fighterParticipations: 0,
  refereeParticipations: 0,
};

export default function OrgDashboardPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  // Invalidate the shell's cached org name + logo whenever the dashboard
  // writes a change; without this the sidebar shows the old logo / name
  // until the next provider mount (i.e. logout + back in).
  const { refetchOrg } = useOrganizerSelectedEvent();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string>('');
  const [brandColorDraft, setBrandColorDraft] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement | null>(null);
  const orgName = org?.name ?? slug;

  const loadOrg = (signal?: AbortSignal) =>
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.dashboard.failedStats'));
        const raw = (await res.json()) as Record<string, unknown>;
        const orgRow: OrgRow = {
          id: String(raw['id']),
          name: String(raw['name'] ?? slug),
          slug: String(raw['slug'] ?? slug),
          logoUrl:
            typeof (raw['logo_url'] ?? raw['logoUrl']) === 'string'
              ? String(raw['logo_url'] ?? raw['logoUrl'])
              : null,
          brandColor:
            typeof (raw['brand_color'] ?? raw['brandColor']) === 'string'
              ? String(raw['brand_color'] ?? raw['brandColor'])
              : null,
        };
        setOrg(orgRow);
        setNameDraft(orgRow.name);
        setBrandColorDraft(orgRow.brandColor ?? '');
        return fetch(`${apiUrl}/api/v1/organizations/${orgRow.id}/dashboard-stats`, {
          credentials: 'include',
          ...(signal ? { signal } : {}),
        });
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.dashboard.failedStats'));
        setStats((await res.json()) as DashboardStats);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.dashboard.failedStats'));
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    const controller = new AbortController();
    void loadOrg(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, apiUrl, t]);

  async function saveName(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!org) return;
    const trimmed = nameDraft.trim();
    const nextBrandColor = brandColorDraft.trim() === '' ? null : brandColorDraft.trim();
    const prevBrandColor = org.brandColor ?? null;
    const nameChanged = trimmed.length > 0 && trimmed !== org.name;
    const brandColorChanged = nextBrandColor !== prevBrandColor;
    if (!nameChanged && !brandColorChanged) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (nameChanged) body['name'] = trimmed;
      if (brandColorChanged) body['brandColor'] = nextBrandColor;
      const res = await fetch(`${apiUrl}/api/v1/organizations/${org.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.dashboard.brand.saveError'));
      }
      setNotice(t('organizer.dashboard.brand.saved'));
      await loadOrg();
      await refetchOrg();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.dashboard.brand.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!org) return;
    if (file.size > 10 * 1024 * 1024) {
      setError(t('organizer.events.logoTooLarge'));
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(t('organizer.events.logoWrongType'));
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.logoUploadFailed'));
      }
      setNotice(t('organizer.events.logoUploadSuccess'));
      await loadOrg();
      await refetchOrg();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.events.logoUploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  const cards = [
    {
      label: t('organizer.dashboard.metrics.eventsCreated'),
      value: stats.eventsTotal,
      detail: t('organizer.dashboard.metrics.eventsCreatedDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.upcomingEvents'),
      value: stats.upcomingEvents,
      detail: t('organizer.dashboard.metrics.upcomingEventsDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.tournaments'),
      value: stats.tournamentsTotal,
      detail: t('organizer.dashboard.metrics.tournamentsDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.fighters'),
      value: stats.fighterParticipations,
      detail: t('organizer.dashboard.metrics.fightersDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.referees'),
      value: stats.refereeParticipations,
      detail: t('organizer.dashboard.metrics.refereesDetail'),
    },
  ];

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.shell.eyebrow')}
        title={orgName}
        subtitle={<span className="font-mono text-slate-500">{slug}</span>}
        actions={
          <Link
            href={`/org/${slug}/events`}
            className="inline-flex w-fit items-center rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('organizer.dashboard.manageEvents')}
          </Link>
        }
      />

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-red-700" />
          {t('organizer.dashboard.loadingStats')}
        </div>
      )}

      <section className="mb-8">
        <StatsGrid cols={3}>
          {cards.map((card) => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              detail={card.detail}
            />
          ))}
        </StatsGrid>
      </section>

      {/* Branding card — rename + logo upload. Slug stays read-only so that
          existing bookmarks/URLs keep working. */}
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {t('organizer.dashboard.brand.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t('organizer.dashboard.brand.description')}</p>

        {notice && (
          <p className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {notice}
          </p>
        )}

        <div className="mt-5 grid gap-6 lg:grid-cols-[200px,1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-32 w-32 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {org?.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={org.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold uppercase tracking-wider text-slate-400">
                  {orgName.slice(0, 2)}
                </div>
              )}
            </div>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(ev: ChangeEvent<HTMLInputElement>) => {
                const file = ev.target.files?.[0];
                if (file) void uploadLogo(file);
                ev.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy || !org}
              onClick={() => logoInput.current?.click()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t('organizer.events.uploadLogo')}
            </button>
          </div>

          <form onSubmit={(ev) => void saveName(ev)} className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              {t('organizer.dashboard.brand.nameLabel')}
              <input
                value={nameDraft}
                onChange={(ev) => setNameDraft(ev.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              {t('organizer.dashboard.brand.slugLabel')}
              <input
                value={org?.slug ?? slug}
                readOnly
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500"
              />
              <span className="text-xs font-normal text-slate-400">
                {t('organizer.dashboard.brand.slugReadOnly')}
              </span>
            </label>
            <div className="grid gap-2 text-sm font-semibold text-slate-700">
              <span>{t('organizer.dashboard.brand.colorLabel')}</span>
              <div className="flex items-center gap-3">
                <ColorSwatchPicker
                  value={brandColorDraft || '#64748b'}
                  onChange={(hex) => setBrandColorDraft(hex)}
                  ariaLabel={t('organizer.dashboard.brand.colorAriaLabel')}
                />
                {brandColorDraft && (
                  <button
                    type="button"
                    onClick={() => setBrandColorDraft('')}
                    className="rounded text-xs font-normal text-slate-500 underline hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                  >
                    {t('organizer.dashboard.brand.colorClear')}
                  </button>
                )}
              </div>
              <span className="text-xs font-normal text-slate-400">
                {t('organizer.dashboard.brand.colorHelp')}
              </span>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={
                  busy ||
                  !org ||
                  (nameDraft.trim() === org.name &&
                    (brandColorDraft.trim() === '' ? null : brandColorDraft.trim()) ===
                      (org.brandColor ?? null)) ||
                  !nameDraft.trim()
                }
                className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('organizer.dashboard.brand.save')}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
