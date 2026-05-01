'use client';

/**
 * Scoring config editor — tournament-level
 * Route: /org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config
 *
 * Organiser can configure:
 *   - Afterblow mode (full | deductive)
 *   - Score buttons: visibility + values
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { AfterblowButton, CleanButton, TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';

export default function ScoringConfigPage() {
  const params = useParams<{
    slug: string;
    eventId: string;
    tournamentId: string;
  }>();
  const { slug, eventId, tournamentId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [config, setConfig] = useState<TournamentScoringConfig>(
    structuredClone(DEFAULT_SCORING_CONFIG),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/scoring-config`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (res.ok) setConfig((await res.json()) as TournamentScoringConfig);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [tournamentId, apiUrl]);

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scoringConfig: config }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { message?: string };
        throw new Error(b.message ?? 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function updateCleanBtn(index: number, patch: Partial<CleanButton>) {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        clean: prev.buttons.clean.map((b, i) => (i === index ? { ...b, ...patch } : b)),
      },
    }));
  }

  function updateAfterblowBtn(index: number, patch: Partial<AfterblowButton>) {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        afterblow: prev.buttons.afterblow.map((b, i) => (i === index ? { ...b, ...patch } : b)),
      },
    }));
  }

  function addCleanBtn() {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        clean: [...prev.buttons.clean, { label: '+1', value: 1, visible: true }],
      },
    }));
  }

  function addAfterblowBtn() {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        afterblow: [
          ...prev.buttons.afterblow,
          { label: '1-0', attackerPts: 1, defenderPts: 0, visible: true },
        ],
      },
    }));
  }

  function removeCleanBtn(index: number) {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        clean: prev.buttons.clean.filter((_, i) => i !== index),
      },
    }));
  }

  function removeAfterblowBtn(index: number) {
    setConfig((prev) => ({
      ...prev,
      buttons: {
        ...prev.buttons,
        afterblow: prev.buttons.afterblow.filter((_, i) => i !== index),
      },
    }));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Scoring config</span>
          </div>
          <h1 className="text-2xl font-bold">Scoring configuration</h1>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* ── Afterblow mode ── */}
      <section className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Afterblow mode
        </h2>
        <div className="flex gap-3">
          {(['full', 'deductive'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setConfig((c) => ({ ...c, afterblowMode: mode }))}
              className={[
                'flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-colors',
                config.afterblowMode === mode
                  ? 'border-red-700 bg-red-50 text-red-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300',
              ].join(' ')}
            >
              <p className="font-bold capitalize">{mode}</p>
              <p className="text-xs font-normal mt-0.5 opacity-70">
                {mode === 'full'
                  ? 'Both fighters score on afterblow'
                  : 'Only attacker scores (defender gets 0)'}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Clean hit buttons ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Clean hit buttons
          </h2>
          <button
            onClick={addCleanBtn}
            className="text-xs text-red-600 hover:underline font-medium"
          >
            + Add button
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {config.buttons.clean.map((btn, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btn.visible}
                  onChange={(e) => updateCleanBtn(i, { visible: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">Visible</span>
              </label>
              <div className="flex items-center gap-2 flex-1">
                <label className="text-xs text-gray-500">Label</label>
                <input
                  type="text"
                  value={btn.label}
                  onChange={(e) => updateCleanBtn(i, { label: e.target.value })}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <label className="text-xs text-gray-500">Points</label>
                <input
                  type="number"
                  value={btn.value}
                  min={0}
                  max={10}
                  onChange={(e) => updateCleanBtn(i, { value: parseInt(e.target.value) || 0 })}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <button
                onClick={() => removeCleanBtn(i)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Afterblow buttons ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Afterblow buttons
          </h2>
          <button
            onClick={addAfterblowBtn}
            className="text-xs text-red-600 hover:underline font-medium"
          >
            + Add button
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {config.afterblowMode === 'deductive'
            ? 'Deductive mode: defender points are ignored (always 0).'
            : 'Full mode: both attacker and defender receive points.'}
        </p>
        <div className="flex flex-col gap-3">
          {config.buttons.afterblow.map((btn, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={btn.visible}
                  onChange={(e) => updateAfterblowBtn(i, { visible: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-600">Visible</span>
              </label>
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <label className="text-xs text-gray-500">Label</label>
                <input
                  type="text"
                  value={btn.label}
                  onChange={(e) => updateAfterblowBtn(i, { label: e.target.value })}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <label className="text-xs text-gray-500">Attacker pts</label>
                <input
                  type="number"
                  value={btn.attackerPts}
                  min={0}
                  max={10}
                  onChange={(e) =>
                    updateAfterblowBtn(i, { attackerPts: parseInt(e.target.value) || 0 })
                  }
                  className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <label className="text-xs text-gray-500">
                  Defender pts
                  {config.afterblowMode === 'deductive' && (
                    <span className="ml-1 text-orange-500">(ignored)</span>
                  )}
                </label>
                <input
                  type="number"
                  value={btn.defenderPts}
                  min={0}
                  max={10}
                  disabled={config.afterblowMode === 'deductive'}
                  onChange={(e) =>
                    updateAfterblowBtn(i, { defenderPts: parseInt(e.target.value) || 0 })
                  }
                  className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 disabled:opacity-40"
                />
              </div>
              <button
                onClick={() => removeAfterblowBtn(i)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live preview ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Button preview
        </h2>
        <div className="bg-gray-950 rounded-xl p-4">
          <div className="grid grid-cols-2 gap-4">
            {(['Rouge', 'Bleu'] as const).map((side) => (
              <div key={side} className="flex flex-col gap-2">
                <div
                  className={[
                    'rounded-xl p-3 text-center border-2',
                    side === 'Rouge' ? 'bg-red-900 border-red-600' : 'bg-blue-900 border-blue-600',
                  ].join(' ')}
                >
                  <p
                    className={[
                      'text-xs font-bold uppercase',
                      side === 'Rouge' ? 'text-red-300' : 'text-blue-300',
                    ].join(' ')}
                  >
                    {side}
                  </p>
                  <p className="text-3xl font-black text-white mt-1">0</p>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {config.buttons.clean
                    .filter((b) => b.visible)
                    .map((b) => (
                      <div
                        key={b.label}
                        className={[
                          'rounded-lg border-2 py-2 text-center font-black text-lg',
                          side === 'Rouge'
                            ? 'border-red-700 bg-red-950 text-red-200'
                            : 'border-blue-700 bg-blue-950 text-blue-200',
                        ].join(' ')}
                      >
                        {b.label}
                      </div>
                    ))}
                  {config.buttons.afterblow
                    .filter((b) => b.visible)
                    .map((b) => (
                      <div
                        key={b.label}
                        className="rounded-lg border-2 border-orange-700 bg-orange-950 text-orange-200 py-1.5 text-center font-bold text-sm"
                      >
                        {b.label}
                        <div className="text-xs opacity-60">
                          {config.afterblowMode === 'deductive'
                            ? `+${b.attackerPts}/0`
                            : `+${b.attackerPts}/+${b.defenderPts}`}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-lg border-2 border-orange-600 bg-orange-900 text-orange-100 py-2 text-center font-bold text-sm">
              Double
            </div>
            <div className="rounded-lg border-2 border-gray-600 bg-gray-800 text-gray-200 py-2 text-center font-bold text-sm">
              No exchange
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
