/* eslint-disable myclash/no-literal-string -- branding editor predates i18n */
'use client';

/**
 * Branding editor (renamed from "Theme" in Slice 4).
 * Route: /org/[slug]/events/[eventId]/theme  — kept for URL stability.
 *
 * Only two affordances remain after the public-redesign scope-down:
 *   - Event logo upload (writes events.logo_url via the canonical
 *     /events/:id/logo endpoint)
 *   - Hero image URL (kept on themes.hero_image_url for now)
 *
 * Per-event colors / font pickers / custom CSS were retired in
 * migration 0086 because none of them actually flowed through to the
 * public app — the unified MyClash design from @myclash/design-tokens
 * governs both apps.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@myclash/ui';

interface BrandingState {
  logoUrl: string;
  heroImageUrl: string;
}

type BrandingAction =
  | { type: 'SET'; field: keyof BrandingState; value: string }
  | { type: 'LOAD'; branding: BrandingState };

const DEFAULTS: BrandingState = {
  logoUrl: '',
  heroImageUrl: '',
};

function reducer(state: BrandingState, action: BrandingAction): BrandingState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'LOAD':
      return action.branding;
    default:
      return state;
  }
}

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default function BrandingEditorPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [branding, dispatch] = useReducer(reducer, DEFAULTS);
  const [eventName, setEventName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

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
          if (typeof ev.logo_url === 'string') {
            dispatch({ type: 'SET', field: 'logoUrl', value: ev.logo_url });
          }
        }
        if (themeRes.ok) {
          const evTheme = (await themeRes.json()) as Partial<BrandingState> | null;
          if (evTheme) {
            dispatch({
              type: 'LOAD',
              branding: {
                logoUrl: evTheme.logoUrl ?? '',
                heroImageUrl: evTheme.heroImageUrl ?? '',
              },
            });
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          logoUrl: branding.logoUrl || null,
          heroImageUrl: branding.heroImageUrl || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to save branding');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError('Logo must be a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be 10 MB or smaller.');
      return;
    }
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('eventId', eventId);
      // Canonical endpoint: writes the file to storage AND sets
      // events.logo_url. Migration 0084 retired the themes.logo_url
      // column so the previously-used /theme/logo route is a shim.
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = (await res.json()) as { url: string };
      dispatch({ type: 'SET', field: 'logoUrl', value: data.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
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
      <div className="mb-6 flex items-center justify-between">
        <div>
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
            Per-event identity affordances. Page colors + typography come from the unified MyClash
            design tokens and apply across both the organiser and public apps.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm font-medium text-emerald-700">✓ Saved</span>}
          <Button
            type="button"
            variant="next"
            onClick={() => void handleSave()}
            disabled={saving}
            loading={saving}
          >
            {saving ? 'Saving…' : 'Save branding'}
          </Button>
        </div>
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
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            Event logo
          </h2>
          <div className="flex items-start gap-5">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
              {branding.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={branding.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold uppercase text-slate-300">
                  {(eventName || '?').slice(0, 2)}
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <input
                type="url"
                value={branding.logoUrl}
                onChange={(e) => dispatch({ type: 'SET', field: 'logoUrl', value: e.target.value })}
                placeholder="https://… or upload below"
                className="rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
              <div className="flex items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoUpload(file);
                  }}
                />
                <Button
                  type="button"
                  variant="back"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  loading={uploadingLogo}
                >
                  {uploadingLogo ? 'Uploading…' : 'Upload image'}
                </Button>
                <p className="text-xs text-slate-500">PNG, JPEG, or WebP up to 10 MB</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            Hero image
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Shown at the top of <code className="font-mono">/e/&lt;slug&gt;/home</code>. Use a wide
            landscape image (≥ 1600px wide).
          </p>
          <input
            type="url"
            value={branding.heroImageUrl}
            onChange={(e) =>
              dispatch({ type: 'SET', field: 'heroImageUrl', value: e.target.value })
            }
            placeholder="https://…"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
          />
        </section>
      </div>
    </main>
  );
}
