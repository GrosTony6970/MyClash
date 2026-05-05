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
import { useI18n } from '../../../../../../../../src/i18n/I18nProvider';

interface PenaltyRulesetSummary {
  id: string;
  name: string;
  code: string;
  version: string;
  built_in: boolean;
}

export default function ScoringConfigPage() {
  const { t } = useI18n();
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
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRulesetSummary[]>([]);
  const [selectedPenaltyRulesetId, setSelectedPenaltyRulesetId] = useState('');
  const [penaltyCsv, setPenaltyCsv] = useState('');
  const [importingPenaltyCsv, setImportingPenaltyCsv] = useState(false);

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

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/penalty-rulesets`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setPenaltyRulesets((await res.json()) as PenaltyRulesetSummary[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl]);

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
        throw new Error(b.message ?? t('organizer.scoringConfig.saveFailed'));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.scoringConfig.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function handlePenaltyRulesetAssign() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/penalty-ruleset`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ penaltyRulesetId: selectedPenaltyRulesetId || null }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { message?: string };
        throw new Error(b.message ?? t('organizer.scoringConfig.penaltyRulesetSaveFailed'));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.scoringConfig.penaltyRulesetSaveFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePenaltyCsvImport() {
    if (!penaltyCsv.trim()) return;
    setImportingPenaltyCsv(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/penalty-rulesets/import-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventId,
          code: `custom-${Date.now()}`,
          version: '1',
          name: t('organizer.scoringConfig.customPenaltyRuleset'),
          accumulationScope: 'match',
          csv: penaltyCsv,
        }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { message?: string };
        throw new Error(b.message ?? t('organizer.scoringConfig.csvImportFailed'));
      }
      const imported = (await res.json()) as PenaltyRulesetSummary;
      setPenaltyRulesets((prev) => [...prev, imported]);
      setSelectedPenaltyRulesetId(imported.id);
      setPenaltyCsv('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.scoringConfig.csvImportFailed'));
    } finally {
      setImportingPenaltyCsv(false);
    }
  }

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
              {t('organizer.scoringConfig.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">
              {t('organizer.scoringConfig.breadcrumbScoringConfig')}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{t('organizer.scoringConfig.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-600 font-medium">
              ✓ {t('organizer.scoringConfig.saved')}
            </span>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {saving ? t('organizer.scoringConfig.saving') : t('actions.save')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* ── Afterblow mode ── */}
      <section className="mb-8 rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          {t('organizer.scoringConfig.penaltyRuleset')}
        </h2>
        <div className="flex gap-3">
          <select
            value={selectedPenaltyRulesetId}
            onChange={(event) => setSelectedPenaltyRulesetId(event.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            <option value="">{t('organizer.scoringConfig.useEventDefault')}</option>
            {penaltyRulesets.map((ruleset) => (
              <option key={ruleset.id} value={ruleset.id}>
                {ruleset.name} ({ruleset.code}@{ruleset.version})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handlePenaltyRulesetAssign()}
            disabled={saving}
            className="bg-gray-900 hover:bg-black disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm"
          >
            {t('organizer.scoringConfig.attach')}
          </button>
        </div>
        <textarea
          value={penaltyCsv}
          onChange={(event) => setPenaltyCsv(event.target.value)}
          placeholder={t('organizer.scoringConfig.penaltyCsvPlaceholder')}
          className="mt-3 w-full min-h-28 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <button
          type="button"
          onClick={() => void handlePenaltyCsvImport()}
          disabled={importingPenaltyCsv || !penaltyCsv.trim()}
          className="mt-2 text-xs text-red-600 hover:underline font-medium disabled:opacity-40"
        >
          {importingPenaltyCsv
            ? t('organizer.scoringConfig.importing')
            : t('organizer.scoringConfig.importPenaltyCsv')}
        </button>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          {t('organizer.scoringConfig.afterblowMode')}
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
              <p className="font-bold capitalize">
                {mode === 'full'
                  ? t('organizer.scoringConfig.modeFull')
                  : t('organizer.scoringConfig.modeDeductive')}
              </p>
              <p className="text-xs font-normal mt-0.5 opacity-70">
                {mode === 'full'
                  ? t('organizer.scoringConfig.fullDescription')
                  : t('organizer.scoringConfig.deductiveDescription')}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Clean hit buttons ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {t('organizer.scoringConfig.cleanHitButtons')}
          </h2>
          <button
            onClick={addCleanBtn}
            className="text-xs text-red-600 hover:underline font-medium"
          >
            + {t('organizer.scoringConfig.addButton')}
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
                <span className="text-sm text-gray-600">
                  {t('organizer.scoringConfig.visible')}
                </span>
              </label>
              <div className="flex items-center gap-2 flex-1">
                <label className="text-xs text-gray-500">
                  {t('organizer.scoringConfig.label')}
                </label>
                <input
                  type="text"
                  value={btn.label}
                  onChange={(e) => updateCleanBtn(i, { label: e.target.value })}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <label className="text-xs text-gray-500">
                  {t('organizer.scoringConfig.points')}
                </label>
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
                {t('organizer.scoringConfig.remove')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Afterblow buttons ── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {t('organizer.scoringConfig.afterblowButtons')}
          </h2>
          <button
            onClick={addAfterblowBtn}
            className="text-xs text-red-600 hover:underline font-medium"
          >
            + {t('organizer.scoringConfig.addButton')}
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {config.afterblowMode === 'deductive'
            ? t('organizer.scoringConfig.deductiveHelp')
            : t('organizer.scoringConfig.fullHelp')}
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
                <span className="text-sm text-gray-600">
                  {t('organizer.scoringConfig.visible')}
                </span>
              </label>
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <label className="text-xs text-gray-500">
                  {t('organizer.scoringConfig.label')}
                </label>
                <input
                  type="text"
                  value={btn.label}
                  onChange={(e) => updateAfterblowBtn(i, { label: e.target.value })}
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <label className="text-xs text-gray-500">
                  {t('organizer.scoringConfig.attackerPts')}
                </label>
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
                  {t('organizer.scoringConfig.defenderPts')}
                  {config.afterblowMode === 'deductive' && (
                    <span className="ml-1 text-orange-500">
                      ({t('organizer.scoringConfig.ignored')})
                    </span>
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
                {t('organizer.scoringConfig.remove')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live preview ── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          {t('organizer.scoringConfig.buttonPreview')}
        </h2>
        <div className="bg-gray-950 rounded-xl p-4">
          <div className="grid grid-cols-2 gap-4">
            {(['red', 'blue'] as const).map((side) => (
              <div key={side} className="flex flex-col gap-2">
                <div
                  className={[
                    'rounded-xl p-3 text-center border-2',
                    side === 'red' ? 'bg-red-900 border-red-600' : 'bg-blue-900 border-blue-600',
                  ].join(' ')}
                >
                  <p
                    className={[
                      'text-xs font-bold uppercase',
                      side === 'red' ? 'text-red-300' : 'text-blue-300',
                    ].join(' ')}
                  >
                    {side === 'red'
                      ? t('organizer.scoringConfig.red')
                      : t('organizer.scoringConfig.blue')}
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
                          side === 'red'
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
              {t('organizer.scoringConfig.double')}
            </div>
            <div className="rounded-lg border-2 border-gray-600 bg-gray-800 text-gray-200 py-2 text-center font-bold text-sm">
              {t('organizer.scoringConfig.noExchange')}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
