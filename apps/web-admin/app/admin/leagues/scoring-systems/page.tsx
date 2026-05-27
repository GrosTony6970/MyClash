'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminPageHeader, ConfirmDialog, RowActionButton, useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface ScoringSystem {
  id: string;
  code: string;
  name: string;
  is_builtin: boolean;
  is_archived: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

function pickPoints(map: Record<string, number>, rank: number): number | null {
  const v = map[String(rank)];
  return v === undefined ? null : v;
}

export default function ScoringSystemsListPage() {
  const [rows, setRows] = useState<ScoringSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<ScoringSystem | null>(null);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not load scoring systems');
      setRows((await res.json()) as ScoringSystem[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scoring systems');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function confirmArchive() {
    if (!pendingArchive) return;
    setBusyId(pendingArchive.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${pendingArchive.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Archive failed');
      }
      toast.success(`Archived "${pendingArchive.name}"`);
      setPendingArchive(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main id="main-content" className="mx-auto w-full px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Leagues"
        title="Scoring systems"
        subtitle="Reusable rank → points presets that any league can adopt."
        actions={
          <div className="flex gap-2">
            <Link
              href="/admin/leagues"
              className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Back to leagues
            </Link>
            <Link
              href="/admin/leagues/scoring-systems/new"
              className="inline-flex items-center rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-900"
            >
              + Create preset
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">1st / 8th / 16th</th>
              <th className="px-4 py-3">Tie-breakers</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-slate-400">
                  No scoring systems yet. Click <strong>Create preset</strong> to add one.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.code}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{row.name}</p>
                  {row.description && (
                    <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {[1, 8, 16]
                    .map((r) => {
                      const v = pickPoints(row.points_by_rank, r);
                      return v === null ? '—' : String(v);
                    })
                    .join(' / ')}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {row.tie_breakers.length === 0 ? '—' : row.tie_breakers.join(' → ')}
                </td>
                <td className="px-4 py-3">
                  {row.is_builtin ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      Built-in
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      Custom
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {row.is_builtin ? (
                      <span className="text-xs text-slate-400">Read-only</span>
                    ) : (
                      <>
                        <Link
                          href={`/admin/leagues/scoring-systems/${row.id}/edit`}
                          className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                        <RowActionButton
                          variant="danger"
                          onClick={() => setPendingArchive(row)}
                          disabled={busyId === row.id}
                        >
                          Archive
                        </RowActionButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingArchive !== null}
        title="Archive scoring system"
        description={
          pendingArchive
            ? `Archive "${pendingArchive.name}"? It will be hidden from new leagues. Cannot be undone if any league still references the code.`
            : ''
        }
        confirmLabel="Archive"
        danger
        busy={busyId === pendingArchive?.id}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void confirmArchive()}
      />
    </main>
  );
}
