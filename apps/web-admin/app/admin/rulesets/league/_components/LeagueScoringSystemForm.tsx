'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AdminPageHeader, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export const ALLOWED_TIE_BREAKERS = [
  'total_points',
  'participation_count',
  'medal_count',
  'double_hit_average',
] as const;

export type TieBreaker = (typeof ALLOWED_TIE_BREAKERS)[number];

/**
 * FFAMHE TF 2026's rank → points table, used as the create-form default
 * so operators have a sensible starting template (the canonical HEMA
 * federation scoring system) rather than 16 empty zeros. Mirrors the
 * seeded `ffamhe_tf_2026` row in migration 0068.
 */
const FFAMHE_DEFAULT_POINTS: Record<string, number> = {
  '1': 16,
  '2': 13,
  '3': 11,
  '4': 10,
  '5': 9,
  '6': 8,
  '7': 7,
  '8': 6,
  '9': 5,
  '10': 4,
  '11': 3,
  '12': 2,
  '13': 1,
  '14': 1,
  '15': 1,
  '16': 1,
};

export interface ScoringSystemFormValues {
  id?: string;
  code: string;
  name: string;
  description: string;
  pointsByRank: Record<string, number>;
  tieBreakers: string[];
}

interface Props {
  mode: 'create' | 'edit';
  initial?: ScoringSystemFormValues;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

const DEFAULT_RANKS = Array.from({ length: 16 }, (_, i) => i + 1);

export function ScoringSystemForm({ mode, initial }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();

  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [autoCode, setAutoCode] = useState(mode === 'create' && !initial?.code);

  // Maintain points as a list of (rank, value) pairs so we can render
  // a stable order even when ranks are added/removed.
  const initialRanks = useMemo(() => {
    if (initial?.pointsByRank) {
      const ranks = Object.keys(initial.pointsByRank)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .sort((a, b) => a - b);
      return ranks.length > 0 ? ranks : DEFAULT_RANKS;
    }
    return DEFAULT_RANKS;
  }, [initial]);

  const [pointsByRank, setPointsByRank] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const r of initialRanks) {
      // Create mode (no `initial`) pre-fills with the FFAMHE TF 2026 table
      // so operators have a sensible HEMA-canonical starting template
      // instead of 16 empty zeros.
      const fallback = mode === 'create' && !initial ? (FFAMHE_DEFAULT_POINTS[String(r)] ?? 0) : 0;
      out[String(r)] = initial?.pointsByRank?.[String(r)] ?? fallback;
    }
    return out;
  });

  const [tieBreakers, setTieBreakers] = useState<string[]>(
    initial?.tieBreakers && initial.tieBreakers.length > 0
      ? initial.tieBreakers
      : [...ALLOWED_TIE_BREAKERS],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onNameChange(value: string) {
    setName(value);
    if (autoCode && mode === 'create') setCode(slugify(value));
  }

  function moveTieBreaker(idx: number, dir: -1 | 1) {
    setTieBreakers((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[idx];
      const b = next[target];
      if (a === undefined || b === undefined) return prev;
      next[idx] = b;
      next[target] = a;
      return next;
    });
  }

  function toggleTieBreaker(value: string) {
    setTieBreakers((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function addRank() {
    setPointsByRank((prev) => {
      const ranks = Object.keys(prev).map(Number);
      const next = ranks.length === 0 ? 1 : Math.max(...ranks) + 1;
      return { ...prev, [String(next)]: 0 };
    });
  }

  function removeRank(rank: string) {
    setPointsByRank((prev) => {
      const next = { ...prev };
      delete next[rank];
      return next;
    });
  }

  /**
   * points_by_rank shape guards. Returns null when valid, or an
   * already-translated error string for inline display. Two invariants:
   *
   * - **Monotonic non-increasing.** Higher ranks (rank 1, 2, …) must
   *   earn at least as many points as lower ranks (rank N+1). This is
   *   the fundamental "winning ranks above" rule.
   * - **At least one positive value.** All-zero rulesets save silently
   *   today and produce meaningless season rankings. Block.
   */
  function validatePoints(points: Record<string, number>): string | null {
    const ranks = Object.keys(points)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);
    if (ranks.length === 0) return null;
    let hasPositive = false;
    for (let i = 0; i < ranks.length - 1; i++) {
      const here = points[String(ranks[i])] ?? 0;
      const next = points[String(ranks[i + 1])] ?? 0;
      if (here < next) {
        return t('admin.rulesets.shared.form.validation.pointsMonotonic', {
          higher: ranks[i] as number,
          lower: ranks[i + 1] as number,
        });
      }
      if (here > 0) hasPositive = true;
    }
    const lastValue = points[String(ranks[ranks.length - 1])] ?? 0;
    if (lastValue > 0) hasPositive = true;
    if (!hasPositive) return t('admin.rulesets.shared.form.validation.pointsAtLeastOnePositive');
    return null;
  }

  async function submit() {
    setBusy(true);
    setError(null);

    // Sanitise first, then validate against the canonical shape. Operators
    // may leave zeros explicit (some rank tables award 0 to deep seeds);
    // we keep them.
    const sanitizedPoints: Record<string, number> = {};
    for (const [k, v] of Object.entries(pointsByRank)) {
      const rank = Number(k);
      if (Number.isInteger(rank) && rank > 0) {
        sanitizedPoints[String(rank)] = Math.max(0, Math.round(Number(v) || 0));
      }
    }

    const validationError = validatePoints(sanitizedPoints);
    if (validationError) {
      setError(validationError);
      setBusy(false);
      return;
    }

    try {
      const url =
        mode === 'create'
          ? `${apiUrl}/api/v1/admin/league-scoring-systems`
          : `${apiUrl}/api/v1/admin/league-scoring-systems/${initial?.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const body =
        mode === 'create'
          ? {
              code: code.trim(),
              name: name.trim(),
              pointsByRank: sanitizedPoints,
              tieBreakers,
              description: description.trim() || null,
            }
          : {
              name: name.trim(),
              pointsByRank: sanitizedPoints,
              tieBreakers,
              description: description.trim() || null,
            };
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message ?? 'Save failed');
      }
      toast.success(
        t(
          mode === 'create'
            ? 'admin.rulesets.league.toast.created'
            : 'admin.rulesets.league.toast.updated',
        ),
      );
      router.push('/admin/rulesets/league');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin.rulesets.league.form.saveError');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const sortedRanks = Object.keys(pointsByRank)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.rulesets.league.form.eyebrow')}
        title={
          mode === 'create'
            ? t('admin.rulesets.league.form.createTitle')
            : t('admin.rulesets.league.form.editTitle', { name: initial?.name ?? '' })
        }
        subtitle={t('admin.rulesets.league.form.editSubtitle')}
        actions={
          <Link
            href="/admin/rulesets/league"
            className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('admin.rulesets.league.form.backButton')}
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            {t('admin.rulesets.league.form.nameLabel')}
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.rulesets.league.form.codeLabel')}
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setAutoCode(false);
                setCode(e.target.value);
              }}
              disabled={mode === 'edit'}
              placeholder={t('admin.rulesets.league.form.codePlaceholder')}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:bg-slate-50"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              {t('admin.rulesets.league.form.codeHelp')}
            </span>
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            {t('admin.rulesets.league.form.descriptionLabel')}
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
            />
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {t('admin.rulesets.league.form.pointsByRankLabel')}
            </p>
            <button
              type="button"
              onClick={addRank}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
            >
              {t('admin.rulesets.league.form.addRankButton')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {sortedRanks.map((rank) => (
              <div key={rank} className="rounded border border-slate-200 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span>{t('admin.rulesets.league.form.rankLabel', { rank })}</span>
                  {sortedRanks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRank(String(rank))}
                      className="rounded text-slate-400 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                      aria-label={t('admin.rulesets.league.form.removeRankAria', { rank })}
                    >
                      ×
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  value={pointsByRank[String(rank)] ?? 0}
                  onChange={(e) =>
                    setPointsByRank((prev) => ({
                      ...prev,
                      [String(rank)]: Number(e.target.value),
                    }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">
            {t('admin.rulesets.league.form.tieBreakersLabel')}
          </p>
          <p className="mb-3 text-xs text-slate-500">
            {t('admin.rulesets.league.form.tieBreakersHelp')}
          </p>
          <ul className="space-y-1">
            {ALLOWED_TIE_BREAKERS.map((dim) => {
              const idx = tieBreakers.indexOf(dim);
              const enabled = idx >= 0;
              return (
                <li
                  key={dim}
                  className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"
                >
                  <label className="flex items-center gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleTieBreaker(dim)}
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                    />
                    <span>
                      {enabled && (
                        <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                          {idx + 1}
                        </span>
                      )}
                      {t(`admin.rulesets.league.form.tieBreakerLabels.${dim}`)}
                    </span>
                  </label>
                  {enabled && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveTieBreaker(idx, -1)}
                        disabled={idx === 0}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-30"
                        aria-label={t('admin.rulesets.league.form.moveUpAria')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTieBreaker(idx, 1)}
                        disabled={idx === tieBreakers.length - 1}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-30"
                        aria-label={t('admin.rulesets.league.form.moveDownAria')}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Link
            href="/admin/rulesets/league"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
          >
            {t('admin.rulesets.league.form.cancelButton')}
          </Link>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {busy
              ? t('admin.rulesets.league.form.savingButton')
              : mode === 'create'
                ? t('admin.rulesets.league.form.createButton')
                : t('admin.rulesets.league.form.saveButton')}
          </button>
        </div>
      </div>
    </main>
  );
}
