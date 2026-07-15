'use client';

/**
 * Branding editor (renamed from "Theme" in Slice 4).
 * Route: /org/[slug]/events/[eventId]/theme  — kept for URL stability.
 *
 * Two upload-only affordances:
 *   - Event logo: square preview + Replace button. Click anywhere on
 *     the preview to open the file picker. POSTs to /events/:id/logo
 *     which writes events.logo_url (canonical column).
 *   - Hero image: wide preview (3:1 aspect) + Replace button. POSTs
 *     to /events/:id/hero which writes themes.hero_image_url.
 *
 * No URL text inputs, no "Save branding" button — every upload
 * persists immediately. Mirrors the org dashboard pattern
 * (apps/web-admin/app/org/[slug]/page.tsx).
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const MAX_HERO_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default function BrandingEditorPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string>('');
  // Captured for the preview's date/place line (approximates the public header).
  const [eventStart, setEventStart] = useState<string | null>(null);
  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [eventCity, setEventCity] = useState<string | null>(null);
  const [eventCountry, setEventCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/theme`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([eventRes, themeRes]) => {
        if (eventRes.ok) {
          const ev = (await eventRes.json()) as {
            name: string;
            logo_url?: string | null;
            start_date?: string | null;
            end_date?: string | null;
            city?: string | null;
            country?: string | null;
          };
          setEventName(ev.name);
          if (typeof ev.logo_url === 'string') setLogoUrl(ev.logo_url);
          setEventStart(ev.start_date ?? null);
          setEventEnd(ev.end_date ?? null);
          setEventCity(ev.city ?? null);
          setEventCountry(ev.country ?? null);
        }
        if (themeRes.ok) {
          const evTheme = (await themeRes.json()) as {
            logoUrl?: string | null;
            heroImageUrl?: string | null;
          } | null;
          if (evTheme) {
            if (typeof evTheme.logoUrl === 'string') setLogoUrl(evTheme.logoUrl);
            if (typeof evTheme.heroImageUrl === 'string') setHeroImageUrl(evTheme.heroImageUrl);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function handleLogoUpload(file: File) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError(t('admin.common.logoTypeInvalid'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('admin.common.logoTooLarge'));
      return;
    }
    setError(null);
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error(t('admin.common.uploadFailed'));
      const data = (await res.json()) as { url: string };
      setLogoUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.logoUploadFailed'));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleHeroUpload(file: File) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError(t('admin.common.heroTypeInvalid'));
      return;
    }
    if (file.size > MAX_HERO_BYTES) {
      setError(t('admin.common.heroTooLarge'));
      return;
    }
    setError(null);
    setUploadingHero(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/hero`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error(t('admin.common.uploadFailed'));
      const data = (await res.json()) as { url: string };
      setHeroImageUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.heroUploadFailed'));
    } finally {
      setUploadingHero(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      </main>
    );
  }

  // Preview date/place line (approximates the public event header).
  const fmtDate = (d: string | null): string | null => {
    if (!d) return null;
    const dt = new Date(d.includes('T') ? d : `${d}T00:00:00`);
    return Number.isNaN(dt.getTime())
      ? null
      : dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const previewPlace = [eventCity, eventCountry].filter(Boolean).join(', ') || null;
  const startLabel = fmtDate(eventStart);
  const endLabel = fmtDate(eventEnd);
  const previewDates =
    startLabel && endLabel && startLabel !== endLabel
      ? `${startLabel} – ${endLabel}`
      : startLabel || endLabel || null;
  const previewMeta = [previewPlace, previewDates].filter(Boolean).join(' · ');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-sm text-muted">
          <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
            {slug}
          </Link>
          <span>/</span>
          <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-foreground-secondary">
            {eventName}
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">{t('organizer.branding.title')}</span>
        </div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('organizer.branding.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.branding.subtitle')}</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {searchParams.get('logoUpload') === 'failed' && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t('organizer.branding.logoUploadFailedBanner')}
        </div>
      )}

      <div className="flex flex-col gap-8">
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.branding.logoSection')}
          </h2>
          <div className="flex items-start gap-5">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              aria-label={
                logoUrl
                  ? t('organizer.branding.replaceLogoAria')
                  : t('organizer.branding.uploadLogoAria')
              }
              className="group h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold uppercase text-muted group-hover:text-foreground-secondary">
                  {(eventName || '?').slice(0, 2)}
                </div>
              )}
            </button>
            <div className="flex flex-1 flex-col gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                className="w-fit rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground-secondary transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingLogo
                  ? t('organizer.branding.uploading')
                  : logoUrl
                    ? t('organizer.branding.replaceLogo')
                    : t('organizer.branding.uploadLogo')}
              </button>
              <p className="text-xs text-muted">{t('organizer.branding.logoHint')}</p>
            </div>
          </div>
        </section>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.branding.heroSection')}
          </h2>
          <p className="mb-3 text-xs text-muted">
            {t('organizer.branding.heroHintPrefix')}{' '}
            <code className="font-mono">/e/&lt;slug&gt;/home</code>{' '}
            {t('organizer.branding.heroHintSuffix')}
          </p>
          <button
            type="button"
            onClick={() => heroInputRef.current?.click()}
            disabled={uploadingHero}
            aria-label={
              heroImageUrl
                ? t('organizer.branding.replaceHeroAria')
                : t('organizer.branding.uploadHeroAria')
            }
            className="group block aspect-[3/1] w-full overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {heroImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={heroImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-medium text-muted group-hover:text-foreground-secondary">
                {uploadingHero
                  ? t('organizer.branding.uploading')
                  : t('organizer.branding.clickToUploadHero')}
              </div>
            )}
          </button>
          <input
            ref={heroInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleHeroUpload(file);
              e.target.value = '';
            }}
          />
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              onClick={() => heroInputRef.current?.click()}
              disabled={uploadingHero}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground-secondary transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadingHero
                ? t('organizer.branding.uploading')
                : heroImageUrl
                  ? t('organizer.branding.replaceHero')
                  : t('organizer.branding.uploadHero')}
            </button>
          </div>
        </section>

        {/* ── Preview ──────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.branding.previewSection')}
          </h2>
          <p className="mb-3 text-xs text-muted">
            {t('organizer.branding.previewHintPrefix')}{' '}
            <code className="font-mono">/e/&lt;slug&gt;/home</code>.
          </p>
          <div className="overflow-hidden rounded-xl border border-border">
            {heroImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={heroImageUrl}
                src={heroImageUrl}
                alt=""
                className="aspect-[16/7] max-h-48 w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[16/7] max-h-48 w-full items-center justify-center border-b border-dashed border-border bg-background text-xs font-medium text-muted">
                {t('organizer.branding.heroPreviewPlaceholder')}
              </div>
            )}
            <div className="flex items-center gap-4 p-4">
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={logoUrl}
                  src={logoUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-lg border border-border bg-surface object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-xl font-bold uppercase text-muted">
                  {(eventName || '?').slice(0, 2)}
                </span>
              )}
              <div className="min-w-0">
                <p className="font-display text-xl font-bold text-foreground">
                  {eventName || t('organizer.branding.eventNameFallback')}
                </p>
                {previewMeta && <p className="mt-0.5 truncate text-sm text-muted">{previewMeta}</p>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
