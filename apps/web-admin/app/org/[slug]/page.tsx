'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { AdminPageHeader, MetricCard, StatsGrid } from '@myclash/ui';
import { DEFAULT_ORG_ACCENT } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useOrganizerSelectedEvent } from '../../../src/components/organizer-event-context';
import { ColorSwatchPicker } from '../../../src/components/ColorSwatchPicker';
import { LogoCropperModal } from './_components/LogoCropperModal';
import { getPublicApiUrl } from '@/lib/api-url';

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
  const apiUrl = getPublicApiUrl();
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
  // File freshly picked from the input — when set, the cropper
  // modal opens. Cleared once the operator saves or cancels.
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
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
      // The BE returns { url } pointing at the freshly-uploaded public
      // storage path. Patch the local org state synchronously here so
      // the 128×128 preview flips to the new logo in the same render
      // pass — the loadOrg/refetchOrg chain below has historically lost
      // races with useEffect cleanups (t-reference changes abort the
      // in-flight fetch, the second .then never runs, setOrg never
      // happens, preview stays on the initials fallback). Reading the
      // response body directly bypasses that path entirely.
      const body = (await res.json().catch(() => ({}))) as { url?: string };
      if (typeof body.url === 'string') {
        setOrg((prev) => (prev ? { ...prev, logoUrl: body.url ?? null } : prev));
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
    <main className="mx-auto max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.shell.eyebrow')}
        title={orgName}
        subtitle={<span className="font-mono text-muted">{slug}</span>}
        actions={
          <Link
            href={`/org/${slug}/events`}
            className="inline-flex w-fit items-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {t('organizer.dashboard.manageEvents')}
          </Link>
        }
      />

      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-6 flex items-center gap-2 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
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
      <section className="rounded-md border border-border bg-surface p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.dashboard.brand.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('organizer.dashboard.brand.description')}</p>

        {notice && (
          <p className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {notice}
          </p>
        )}

        <div className="mt-5 grid gap-6 lg:grid-cols-[200px,1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-32 w-32 overflow-hidden rounded-lg border border-border bg-background">
              {org?.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={org.logoUrl}
                  src={org.logoUrl}
                  alt=""
                  onError={() =>
                    console.warn('[org-logo] dashboard preview failed to render', org.logoUrl)
                  }
                  className="h-full w-full object-contain p-1"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold uppercase tracking-wider text-muted">
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
                // Validate up front so a bad file doesn't open the
                // cropper. Once it opens, the operator's only escape
                // is Cancel — surfacing the size / type error here
                // mirrors the previous flow.
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError(t('organizer.events.logoTooLarge'));
                  ev.target.value = '';
                  return;
                }
                if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                  setError(t('organizer.events.logoWrongType'));
                  ev.target.value = '';
                  return;
                }
                setPendingLogoFile(file);
                ev.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy || !org}
              onClick={() => logoInput.current?.click()}
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t('organizer.events.uploadLogo')}
            </button>
          </div>

          <form onSubmit={(ev) => void saveName(ev)} className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('organizer.dashboard.brand.nameLabel')}
              <input
                value={nameDraft}
                onChange={(ev) => setNameDraft(ev.target.value)}
                className="rounded-md border border-border px-3 py-2 text-sm"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
              {t('organizer.dashboard.brand.slugLabel')}
              <input
                value={org?.slug ?? slug}
                readOnly
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-muted"
              />
              <span className="text-xs font-normal text-muted">
                {t('organizer.dashboard.brand.slugReadOnly')}
              </span>
            </label>
            <div className="grid gap-4 md:grid-cols-2 md:gap-6">
              <div className="grid gap-2 text-sm font-semibold text-foreground-secondary">
                <span>{t('organizer.dashboard.brand.colorLabel')}</span>
                <div className="flex items-center gap-3">
                  <ColorSwatchPicker
                    value={brandColorDraft}
                    defaultColor={DEFAULT_ORG_ACCENT}
                    onChange={(hex) => setBrandColorDraft(hex)}
                    ariaLabel={t('organizer.dashboard.brand.colorAriaLabel')}
                  />
                  {brandColorDraft && (
                    <button
                      type="button"
                      onClick={() => setBrandColorDraft('')}
                      className="rounded text-xs font-normal text-muted underline hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {t('organizer.dashboard.brand.colorClear')}
                    </button>
                  )}
                </div>
                <span className="text-xs font-normal text-muted">
                  {t('organizer.dashboard.brand.colorHelp')}
                </span>
              </div>
              <BrandColorPreview
                color={brandColorDraft}
                orgName={orgName}
                logoUrl={org?.logoUrl ?? null}
              />
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
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('organizer.dashboard.brand.save')}
              </button>
            </div>
          </form>
        </div>
      </section>

      {pendingLogoFile && (
        <LogoCropperModal
          file={pendingLogoFile}
          onCancel={() => setPendingLogoFile(null)}
          onSave={async (blob) => {
            // Bake the crop into a File so the existing uploadLogo
            // happy path (validation + FormData + toast + refetch)
            // doesn't need to fork. The blob is always a baked PNG,
            // already under the size cap unless the source was huge.
            const cropped = new File([blob], 'logo.png', { type: 'image/png' });
            setPendingLogoFile(null);
            await uploadLogo(cropped);
          }}
        />
      )}
    </main>
  );
}

/**
 * Live preview of the brand colour applied to its canonical surface
 * — the public event-card accent stripe, applied at
 * apps/web-public/app/_components/EventsListSections.tsx:264 and :330.
 * When the operator picks a swatch the left border + "Live" pill
 * update immediately; when the colour is cleared both fall back to
 * DEFAULT_ORG_ACCENT, the same constant the public page reads, so the
 * preview is pixel-faithful for both states.
 */
function BrandColorPreview({
  color,
  orgName,
  logoUrl,
}: {
  color: string;
  orgName: string;
  logoUrl?: string | null;
}) {
  const { t } = useI18n();
  const accent = color || DEFAULT_ORG_ACCENT;
  return (
    <div className="grid gap-2 text-sm font-semibold text-foreground-secondary">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.dashboard.brand.previewLabel')}
      </span>
      <div
        className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
        style={{ borderLeftWidth: '4px', borderLeftColor: accent }}
      >
        <div className="mb-2 flex items-center gap-2">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={logoUrl}
              src={logoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md border border-border bg-surface object-contain p-0.5"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-bold uppercase tracking-wider text-muted">
              {orgName.slice(0, 2)}
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white"
            style={{ backgroundColor: accent }}
          >
            {t('organizer.dashboard.brand.previewLivePill')}
          </span>
        </div>
        <p className="text-base font-semibold text-foreground">
          {t('organizer.dashboard.brand.previewEventTitle')}
        </p>
        <p className="text-xs font-normal text-muted">
          {orgName} · {t('organizer.dashboard.brand.previewEventDate')}
        </p>
      </div>
    </div>
  );
}
