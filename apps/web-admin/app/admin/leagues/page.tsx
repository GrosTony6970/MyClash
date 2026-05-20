'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminPageHeader,
  ConfirmDialog,
  RowActionButton,
  SortableHeader,
  rowActionClasses,
  useSortableList,
  useToast,
} from '@myclash/ui';
import { t } from '@myclash/i18n';

interface League {
  id: string;
  slug: string;
  name: string;
  season_year: number;
  status: string;
  public_visibility: boolean;
  logo_url: string | null;
  scoring_system: string;
  scoring_config: {
    scoringSystem?: 'ffamhe_tf_2026' | 'custom';
    rankingDimensions?: 'weapon' | 'weapon_category';
  } | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatScoringSystem(value: string): string {
  if (value === 'ffamhe_tf_2026') return 'FFAMHE TF 2026';
  if (value === 'custom') return 'Custom';
  return value;
}

function formatCategory(value: string | undefined): string {
  if (value === 'weapon') return 'Weapon';
  if (value === 'weapon_category') return 'Weapon + Category';
  return '—';
}

export default function AdminLeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchLeagues = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`${apiUrl}/api/v1/admin/leagues`, {
      credentials: 'include',
      signal,
    });
    if (!res.ok) throw new Error('Could not load leagues');
    return (await res.json()) as League[];
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLeagues(controller.signal)
      .then((data) => {
        setLeagues(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not load leagues');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fetchLeagues]);

  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<League | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const league = pendingDelete;
    setBusyId(league.id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${league.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Delete failed');
      }
      setLeagues((prev) => prev.filter((l) => l.id !== league.id));
      toast.success(`Deleted "${league.name}"`);
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  const getLeagueSortValue = useCallback((row: League, key: string): unknown => {
    switch (key) {
      case 'name':
        return row.name;
      case 'year':
        return row.season_year;
      case 'category':
        return row.scoring_config?.rankingDimensions ?? '';
      case 'scoringSystem':
        return formatScoringSystem(row.scoring_system);
      case 'status':
        return row.status;
      default:
        return null;
    }
  }, []);
  const {
    sorted: visibleLeagues,
    sortKey,
    direction,
    toggle,
  } = useSortableList(leagues, getLeagueSortValue);

  return (
    <main id="main-content" className="mx-auto w-full px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Leagues"
        title="Leagues"
        subtitle="Manage league setup, scoring, member orgs, and linked tournaments."
        actions={
          <Link
            href="/admin/leagues/new"
            className="inline-flex items-center rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-900"
          >
            + Create league
          </Link>
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
              <th className="px-4 py-3 w-16">Logo</th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Name"
                  columnKey="name"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Year"
                  columnKey="year"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Category"
                  columnKey="category"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Scoring system"
                  columnKey="scoringSystem"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="px-4 py-3">
                <SortableHeader
                  label="Status"
                  columnKey="status"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="px-4 py-3">Public</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && leagues.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                  No leagues yet. Click <strong>Create league</strong> to add one.
                </td>
              </tr>
            )}
            {visibleLeagues.map((league) => (
              <tr key={league.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  {league.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={league.logo_url}
                      alt={league.name}
                      className="h-9 w-9 rounded-md border border-slate-200 bg-white object-contain"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                      {initialsFor(league.name)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{league.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">/{league.slug}</p>
                </td>
                <td className="px-4 py-3 text-slate-700">{league.season_year}</td>
                <td className="px-4 py-3 text-slate-700">
                  {formatCategory(league.scoring_config?.rankingDimensions)}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {formatScoringSystem(league.scoring_system)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      league.status === 'published'
                        ? 'bg-green-100 text-green-700'
                        : league.status === 'archived'
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-amber-100 text-amber-700',
                    ].join(' ')}
                  >
                    {league.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {league.public_visibility ? 'Yes' : 'No'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/leagues/${league.id}/edit`}
                      className={rowActionClasses('edit')}
                    >
                      Edit
                    </Link>
                    <RowActionButton
                      variant="danger"
                      onClick={() => setPendingDelete(league)}
                      disabled={busyId === league.id}
                    >
                      Delete
                    </RowActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete league"
        description={
          pendingDelete ? `Delete league "${pendingDelete.name}"? This cannot be undone.` : ''
        }
        confirmLabel="Delete"
        danger
        busy={busyId === pendingDelete?.id}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}
