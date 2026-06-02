/* eslint-disable myclash/no-literal-string -- branding editor predates i18n */
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

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const MAX_HERO_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default function BrandingEditorPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string>('');
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
          const ev = (await eventRes.json()) as { name: string; logo_url?: string | null };
          setEventName(ev.name);
          if (typeof ev.logo_url === 'string') setLogoUrl(ev.logo_url);
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
      setError('Logo must be a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be 10 MB or smaller.');
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
      if (!res.ok) throw new Error('Upload failed');
      const data = (await res.json()) as { url: string };
      setLogoUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleHeroUpload(file: File) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError('Hero must be a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_HERO_BYTES) {
      setError('Hero must be 10 MB or smaller.');
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
      if (!res.ok) throw new Error('Upload failed');
      const data = (await res.json()) as { url: string };
      setHeroImageUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hero upload failed');
    } finally {
      setUploadingHero(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-red-700" />
      </main>
    );
  }

  return (
    <main className="max-w-3xl p-8">
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-sm text-slate-500">
          <Link href={`/org/${slug}`} className="hover:text-slate-700">
            {slug}
          </Link>
          <span>/</span>
          <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-slate-700">
            {eventName}
          </Link>
          <span>/</span>
          <span className="font-medium text-slate-900">Branding</span>
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Branding</h1>
        <p className="mt-1 text-sm text-slate-500">
          Per-event identity: logo and hero image. Page colors + typography come from the unified
          MyClash design tokens and apply across both the organiser and public apps.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {searchParams.get('logoUpload') === 'failed' && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Logo upload failed during event creation. Upload it again here.
        </div>
      )}

      <div className="flex flex-col gap-8">
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            Event logo
          </h2>
          <div className="flex items-start gap-5">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              aria-label={logoUrl ? 'Replace event logo' : 'Upload event logo'}
              className="group h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 transition-colors hover:border-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold uppercase text-slate-300 group-hover:text-slate-400">
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
                className="w-fit rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              <p className="text-xs text-slate-500">
                Square crop, ideally 256×256 or larger. PNG, JPEG, or WebP up to 10 MB.
              </p>
            </div>
          </div>
        </section>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            Hero image
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Shown at the top of <code className="font-mono">/e/&lt;slug&gt;/home</code> for
            spectators. Landscape image, ideally 1920 × 800 (or wider). PNG, JPEG, or WebP up to 10
            MB.
          </p>
          <button
            type="button"
            onClick={() => heroInputRef.current?.click()}
            disabled={uploadingHero}
            aria-label={heroImageUrl ? 'Replace hero image' : 'Upload hero image'}
            className="group block aspect-[3/1] w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50 transition-colors hover:border-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {heroImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={heroImageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-medium text-slate-400 group-hover:text-slate-600">
                {uploadingHero ? 'Uploading…' : 'Click to upload a hero image'}
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
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadingHero ? 'Uploading…' : heroImageUrl ? 'Replace hero' : 'Upload hero'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
