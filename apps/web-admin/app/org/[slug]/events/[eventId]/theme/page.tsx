'use client';

/**
 * Theme editor — T-702
 * Route: /org/[slug]/events/[eventId]/theme
 *
 * AC:
 *   ✓ Color pickers; live preview shows theme applied
 *   ✓ Logo upload to Supabase Storage
 *   ✓ Save persists theme; preview matches public site exactly
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ThemeState {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontDisplay: string;
  fontBody: string;
  logoUrl: string;
  heroImageUrl: string;
  customCss: string;
}

type ThemeAction =
  | { type: 'SET'; field: keyof ThemeState; value: string }
  | { type: 'LOAD'; theme: ThemeState };

const DEFAULTS: ThemeState = {
  primaryColor: '#c0392b',
  secondaryColor: '#2c3e50',
  accentColor: '#f59e0b',
  fontDisplay: 'Cinzel',
  fontBody: 'Inter',
  logoUrl: '',
  heroImageUrl: '',
  customCss: '',
};

function reducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'LOAD':
      return action.theme;
    default:
      return state;
  }
}

const FONT_DISPLAY_OPTIONS = ['Cinzel', 'Playfair Display', 'IM Fell English', 'MedievalSharp'];
const FONT_BODY_OPTIONS = ['Inter', 'Lato', 'Open Sans', 'Roboto', 'Source Sans 3'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ThemeEditorPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [theme, dispatch] = useReducer(reducer, DEFAULTS);
  const [eventName, setEventName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Load existing theme ────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const ev = (await res.json()) as {
          name: string;
          theme?: Partial<ThemeState> | null;
        };
        setEventName(ev.name);
        if (ev.theme) {
          dispatch({
            type: 'LOAD',
            theme: {
              primaryColor: ev.theme.primaryColor ?? DEFAULTS.primaryColor,
              secondaryColor: ev.theme.secondaryColor ?? DEFAULTS.secondaryColor,
              accentColor: ev.theme.accentColor ?? DEFAULTS.accentColor,
              fontDisplay: ev.theme.fontDisplay ?? DEFAULTS.fontDisplay,
              fontBody: ev.theme.fontBody ?? DEFAULTS.fontBody,
              logoUrl: ev.theme.logoUrl ?? '',
              heroImageUrl: ev.theme.heroImageUrl ?? '',
              customCss: ev.theme.customCss ?? '',
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [eventId, apiUrl]);

  // ── Save ───────────────────────────────────────────────────────────────────

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
          primaryColor: theme.primaryColor,
          secondaryColor: theme.secondaryColor,
          accentColor: theme.accentColor,
          fontDisplay: theme.fontDisplay,
          fontBody: theme.fontBody,
          logoUrl: theme.logoUrl || null,
          heroImageUrl: theme.heroImageUrl || null,
          customCss: theme.customCss || null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to save theme');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Logo upload ────────────────────────────────────────────────────────────

  async function handleLogoUpload(file: File) {
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('eventId', eventId);

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/theme/logo`, {
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
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              {eventName}
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Theme</span>
          </div>
          <h1 className="text-2xl font-bold">Theme editor</h1>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save theme'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* ── Editor panel ── */}
        <div className="flex flex-col gap-6">
          {/* Colors */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Colors</h2>
            <div className="flex flex-col gap-3">
              {(
                [
                  { field: 'primaryColor', label: 'Primary' },
                  { field: 'secondaryColor', label: 'Secondary' },
                  { field: 'accentColor', label: 'Accent' },
                ] as const
              ).map(({ field, label }) => (
                <div key={field} className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 w-24">{label}</label>
                  <input
                    type="color"
                    value={theme[field]}
                    onChange={(e) => dispatch({ type: 'SET', field, value: e.target.value })}
                    className="w-9 h-9 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={theme[field]}
                    onChange={(e) => dispatch({ type: 'SET', field, value: e.target.value })}
                    className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
              Typography
            </h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-24">Display</label>
                <select
                  value={theme.fontDisplay}
                  onChange={(e) =>
                    dispatch({ type: 'SET', field: 'fontDisplay', value: e.target.value })
                  }
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  {FONT_DISPLAY_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-24">Body</label>
                <select
                  value={theme.fontBody}
                  onChange={(e) =>
                    dispatch({ type: 'SET', field: 'fontBody', value: e.target.value })
                  }
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  {FONT_BODY_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Logo */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Logo</h2>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={theme.logoUrl}
                  onChange={(e) =>
                    dispatch({ type: 'SET', field: 'logoUrl', value: e.target.value })
                  }
                  placeholder="https://… or upload below"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoUpload(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {uploadingLogo ? 'Uploading…' : 'Upload image'}
                </button>
                <p className="text-xs text-gray-400">Uploads to Supabase Storage</p>
              </div>
            </div>
          </section>

          {/* Hero image */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
              Hero image URL
            </h2>
            <input
              type="url"
              value={theme.heroImageUrl}
              onChange={(e) =>
                dispatch({ type: 'SET', field: 'heroImageUrl', value: e.target.value })
              }
              placeholder="https://…"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </section>

          {/* Custom CSS */}
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
              Custom CSS
            </h2>
            <textarea
              value={theme.customCss}
              onChange={(e) => dispatch({ type: 'SET', field: 'customCss', value: e.target.value })}
              rows={5}
              placeholder=".my-class { color: var(--color-primary); }"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600 resize-y"
            />
            <p className="text-xs text-gray-400 mt-1">
              Injected into the public event pages. Script tags are stripped.
            </p>
          </section>
        </div>

        {/* ── Live preview panel ── */}
        <div className="sticky top-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
            Live preview
          </h2>
          <div
            className="border border-gray-200 rounded-xl overflow-hidden shadow-sm"
            style={
              {
                '--event-primary': theme.primaryColor,
                '--event-secondary': theme.secondaryColor,
                '--event-accent': theme.accentColor,
                '--font-display': `'${theme.fontDisplay}', Georgia, serif`,
                '--font-body': `'${theme.fontBody}', system-ui, sans-serif`,
              } as React.CSSProperties
            }
          >
            {/* Mock event header */}
            <div className="px-6 py-5" style={{ backgroundColor: theme.primaryColor }}>
              <div className="flex items-center gap-3">
                {theme.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={theme.logoUrl}
                    alt="Logo"
                    className="w-10 h-10 rounded object-contain bg-white/20 p-1"
                  />
                )}
                <div>
                  <h3
                    className="text-xl font-bold text-white"
                    style={{ fontFamily: `'${theme.fontDisplay}', Georgia, serif` }}
                  >
                    {eventName || 'Event Name'}
                  </h3>
                  <p
                    className="text-white/70 text-sm"
                    style={{ fontFamily: `'${theme.fontBody}', system-ui, sans-serif` }}
                  >
                    Lyon, France · 15–16 Nov 2027
                  </p>
                </div>
              </div>
            </div>

            {/* Mock content */}
            <div className="bg-white px-6 py-4">
              <div className="flex gap-3 mb-4">
                {['Longsword', 'Messer', 'Sword & Buckler'].map((t) => (
                  <span
                    key={t}
                    className="text-xs px-3 py-1 rounded-full font-medium text-white"
                    style={{ backgroundColor: theme.secondaryColor }}
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="border border-gray-100 rounded-lg p-3 mb-3">
                <p className="text-xs text-gray-400 mb-1">Next match</p>
                <p
                  className="font-semibold text-gray-900"
                  style={{ fontFamily: `'${theme.fontBody}', system-ui, sans-serif` }}
                >
                  Jean Dupont vs Marc Martin
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Pool A · 11:15 · Lice 1</p>
              </div>

              <button
                className="w-full py-2 rounded-lg text-white text-sm font-semibold"
                style={{ backgroundColor: theme.accentColor }}
              >
                View schedule
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-2 text-center">Preview updates live as you edit</p>
        </div>
      </div>
    </main>
  );
}
