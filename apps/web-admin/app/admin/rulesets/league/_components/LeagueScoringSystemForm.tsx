'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AdminPageHeader, useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export const ALLOWED_TIE_BREAKERS = [
  'total_points',
  'participation_count',
  'medal_count',
  'double_hit_average',
] as const;

export type TieBreaker = (typeof ALLOWED_TIE_BREAKERS)[number];

const TIE_BREAKER_LABELS: Record<TieBreaker, string> = {
  total_points: 'Total points',
  participation_count: 'Participation count',
  medal_count: 'Medal count',
  double_hit_average: 'Double-hit average (lower first)',
};

export interface ScoringSystemFormValues {
  id?: string;
  code: string;
  name: string;
  description: string;
  pointsByRank: Record<string, number>;
  tieBreakers: string[];
  isBuiltin?: boolean;
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
      out[String(r)] = initial?.pointsByRank?.[String(r)] ?? 0;
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

  const isBuiltin = initial?.isBuiltin === true;

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

  async function submit() {
    if (isBuiltin) return;
    setBusy(true);
    setError(null);

    // Strip zero-only entries? Operator might want zeros explicit. Keep all.
    const sanitizedPoints: Record<string, number> = {};
    for (const [k, v] of Object.entries(pointsByRank)) {
      const rank = Number(k);
      if (Number.isInteger(rank) && rank > 0) {
        sanitizedPoints[String(rank)] = Math.max(0, Math.round(Number(v) || 0));
      }
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
      toast.success(mode === 'create' ? 'Scoring system created' : 'Scoring system updated');
      router.push('/admin/rulesets/league');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
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
        eyebrow="Leagues / Scoring systems"
        title={mode === 'create' ? 'Create scoring system' : `Edit "${initial?.name ?? ''}"`}
        subtitle={
          isBuiltin
            ? 'This is a built-in preset and is read-only.'
            : 'Rank → points table and tie-breaker ordering. Reusable across leagues.'
        }
        actions={
          <Link
            href="/admin/rulesets/league"
            className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← Back
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
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={isBuiltin}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Code
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setAutoCode(false);
                setCode(e.target.value);
              }}
              disabled={isBuiltin || mode === 'edit'}
              placeholder="e.g. ffamhe_tf_2027"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs disabled:bg-slate-50"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              Lowercase letters, digits, underscores. Cannot be changed after creation.
            </span>
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Description
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBuiltin}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Points by rank</p>
            {!isBuiltin && (
              <button
                type="button"
                onClick={addRank}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                + Add rank
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {sortedRanks.map((rank) => (
              <div key={rank} className="rounded border border-slate-200 p-2">
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span>Rank {rank}</span>
                  {!isBuiltin && sortedRanks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRank(String(rank))}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Remove rank ${rank}`}
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
                  disabled={isBuiltin}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">Tie-breaker order</p>
          <p className="mb-3 text-xs text-slate-500">
            Earlier entries are applied first. Toggle to include/exclude; arrows reorder.
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
                      disabled={isBuiltin}
                    />
                    <span>
                      {enabled && (
                        <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono">
                          {idx + 1}
                        </span>
                      )}
                      {TIE_BREAKER_LABELS[dim]}
                    </span>
                  </label>
                  {enabled && !isBuiltin && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveTieBreaker(idx, -1)}
                        disabled={idx === 0}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTieBreaker(idx, 1)}
                        disabled={idx === tieBreakers.length - 1}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-30"
                        aria-label="Move down"
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

        {!isBuiltin && (
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Link
              href="/admin/rulesets/league"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900 disabled:opacity-60"
            >
              {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
