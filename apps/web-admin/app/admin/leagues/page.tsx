'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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

  async function handleDelete(league: League) {
    if (!window.confirm(`Delete league "${league.name}"? This cannot be undone.`)) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leagues</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage league setup, scoring, member orgs, and linked tournaments.
          </p>
        </div>
        <Link
          href="/admin/leagues/new"
          className="inline-flex w-fit items-center rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          + Create league
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 w-16">Logo</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Year</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Scoring system</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Public</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && leagues.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-gray-400">
                  No leagues yet. Click <strong>Create league</strong> to add one.
                </td>
              </tr>
            )}
            {leagues.map((league) => (
              <tr key={league.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/leagues/${league.id}/edit`}
                      className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDelete(league)}
                      disabled={busyId === league.id}
                      className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
