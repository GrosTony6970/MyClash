'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from './league-utils';

interface League {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  season_year: number;
  status: string;
  public_visibility: boolean;
  scoring_system: string;
  scoring_config: {
    scoringSystem: 'ffamhe_tf_2026' | 'custom';
    rankingDimensions: 'weapon' | 'weapon_category';
    customPointsByRank?: Record<number, number>;
    tieBreakers: string[];
  } | null;
}

interface TournamentLink {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'removed';
  tournaments?: {
    id?: string | null;
    name?: string | null;
    weapon?: string | null;
    category?: string | null;
    events?: { id?: string | null; name?: string | null } | null;
  } | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function AdminLeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [links, setLinks] = useState<Record<string, TournamentLink[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    seasonYear: String(new Date().getFullYear()),
    scoringSystem: 'ffamhe_tf_2026',
    rankingDimensions: 'weapon',
  });
  const [slugDetached, setSlugDetached] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    status: string;
    publicVisibility: boolean;
    scoringSystem: 'ffamhe_tf_2026' | 'custom';
    pointRows: Array<{ rank: number; points: number }>;
  }>({
    name: '',
    description: '',
    status: 'draft',
    publicVisibility: false,
    scoringSystem: 'ffamhe_tf_2026',
    pointRows: [],
  });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.loadError'));
        return res.json() as Promise<League[]>;
      })
      .then((rows) => {
        setLeagues(rows);
        setError(null);
        return Promise.all(
          rows.map((league) =>
            fetch(`${apiUrl}/api/v1/admin/leagues/${league.id}/tournament-links`, {
              credentials: 'include',
            })
              .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
              .then((leagueLinks) => [league.id, leagueLinks] as const),
          ),
        );
      })
      .then((entries) => setLinks(Object.fromEntries(entries)))
      .catch(() => setError(t('admin.leagues.loadError')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const createLeague = () => {
    fetch(`${apiUrl}/api/v1/admin/leagues`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        slug: form.slug,
        seasonYear: Number(form.seasonYear),
        scoringSystem: form.scoringSystem,
        rankingDimensions: form.rankingDimensions,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.createError'));
        setSlugDetached(false);
        setForm((current) => ({ ...current, name: '', slug: '' }));
        load();
      })
      .catch(() => setError(t('admin.leagues.createError')));
  };

  const review = (linkId: string, status: 'approved' | 'rejected') => {
    fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.reviewError'));
        load();
      })
      .catch(() => setError(t('admin.leagues.reviewError')));
  };

  const recompute = (leagueId: string) => {
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/recompute`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.recomputeError'));
        load();
      })
      .catch(() => setError(t('admin.leagues.recomputeError')));
  };

  const openEdit = (league: League) => {
    setEditId(league.id);
    const cfg = league.scoring_config;
    const isCustom = cfg?.scoringSystem === 'custom';
    setEditForm({
      name: league.name,
      description: league.description ?? '',
      status: league.status,
      publicVisibility: league.public_visibility,
      scoringSystem: isCustom ? 'custom' : 'ffamhe_tf_2026',
      pointRows:
        isCustom && cfg?.customPointsByRank
          ? Object.entries(cfg.customPointsByRank)
              .map(([rank, points]) => ({ rank: Number(rank), points: Number(points) }))
              .sort((a, b) => a.rank - b.rank)
          : [],
    });
  };

  const saveEdit = () => {
    if (!editId) return;
    const existingLeague = leagues.find((l) => l.id === editId);
    const existingCfg = existingLeague?.scoring_config;

    const scoringConfig =
      editForm.scoringSystem === 'custom'
        ? {
            scoringSystem: 'custom' as const,
            rankingDimensions: existingCfg?.rankingDimensions ?? 'weapon',
            tieBreakers: existingCfg?.tieBreakers ?? [
              'total_points',
              'participation_count',
              'medal_count',
              'double_hit_average',
            ],
            customPointsByRank: Object.fromEntries(
              editForm.pointRows.map((r) => [r.rank, r.points]),
            ),
          }
        : {
            scoringSystem: 'ffamhe_tf_2026' as const,
            rankingDimensions: existingCfg?.rankingDimensions ?? 'weapon',
            tieBreakers: existingCfg?.tieBreakers ?? [
              'total_points',
              'participation_count',
              'medal_count',
              'double_hit_average',
            ],
          };

    fetch(`${apiUrl}/api/v1/admin/leagues/${editId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name,
        description: editForm.description || undefined,
        status: editForm.status,
        publicVisibility: editForm.publicVisibility,
        scoringConfig,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Update failed');
        setEditId(null);
        load();
      })
      .catch(() => setError('Failed to update league'));
  };

  const deleteLeague = (leagueId: string, name: string) => {
    if (!window.confirm(`Delete league "${name}"? This cannot be undone.`)) return;
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error('Delete failed');
        load();
      })
      .catch(() => setError('Failed to delete league'));
  };

  return (
    <main className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold">{t('admin.leagues.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('admin.leagues.description')}</p>
      </div>

      <section className="mb-8 border border-gray-200 rounded-lg p-5">
        <h2 className="font-semibold mb-4">{t('admin.leagues.createTitle')}</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder={t('admin.leagues.name')}
            value={form.name}
            onChange={(event) => {
              const name = event.target.value;
              setForm((f) => ({ ...f, name, slug: slugDetached ? f.slug : toSlug(name) }));
            }}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder={t('admin.leagues.slug')}
            value={form.slug}
            onChange={(event) => {
              setSlugDetached(true);
              setForm((f) => ({ ...f, slug: event.target.value }));
            }}
          />
          <input
            className="border rounded px-3 py-2 text-sm"
            placeholder={t('admin.leagues.seasonYear')}
            value={form.seasonYear}
            onChange={(event) => setForm({ ...form, seasonYear: event.target.value })}
          />
          <select
            className="border rounded px-3 py-2 text-sm"
            value={form.rankingDimensions}
            onChange={(event) => setForm({ ...form, rankingDimensions: event.target.value })}
          >
            <option value="weapon">{t('admin.leagues.dimensions.weapon')}</option>
            <option value="weapon_category">{t('admin.leagues.dimensions.weapon_category')}</option>
          </select>
          <button
            className="bg-gray-950 text-white rounded px-3 py-2 text-sm"
            onClick={createLeague}
          >
            {t('admin.leagues.create')}
          </button>
        </div>
      </section>

      {loading && <p className="text-sm text-gray-500">{t('admin.leagues.loading')}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && leagues.length === 0 && (
        <p className="text-sm text-gray-500">{t('admin.leagues.empty')}</p>
      )}

      <div className="grid gap-4">
        {leagues.map((league) => (
          <section key={league.id} className="border border-gray-200 rounded-lg p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-gray-950">{league.name}</h2>
                <p className="text-sm text-gray-500">
                  {league.season_year} -{' '}
                  {league.public_visibility
                    ? t('admin.leagues.public')
                    : t('admin.leagues.private')}
                  {' — '}
                  <span className="capitalize">{league.status}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link className="text-sm underline" href={`/leagues/${league.slug}`}>
                  {t('admin.leagues.standings')}
                </Link>
                <a
                  className="text-sm underline"
                  href={`${apiUrl}/api/v1/leagues/${league.id}/final-report.csv`}
                >
                  {t('admin.leagues.csvReport')}
                </a>
                <a
                  className="text-sm underline"
                  href={`${apiUrl}/api/v1/leagues/${league.id}/final-report.print.html`}
                >
                  {t('admin.leagues.printReport')}
                </a>
                <button className="text-sm underline" onClick={() => recompute(league.id)}>
                  {t('admin.leagues.recompute')}
                </button>
                <button
                  className="text-sm underline"
                  onClick={() => (editId === league.id ? setEditId(null) : openEdit(league))}
                >
                  {editId === league.id ? 'Cancel' : 'Edit'}
                </button>
                <button
                  className="text-sm underline text-red-600"
                  onClick={() => deleteLeague(league.id, league.name)}
                >
                  Delete
                </button>
              </div>
            </div>

            {editId === league.id && (
              <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4">
                <input
                  className="border rounded px-3 py-2 text-sm"
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
                <textarea
                  className="border rounded px-3 py-2 text-sm"
                  placeholder="Description (optional)"
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex flex-wrap gap-4 items-center">
                  <select
                    className="border rounded px-3 py-2 text-sm"
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.publicVisibility}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, publicVisibility: e.target.checked }))
                      }
                    />
                    Public
                  </label>
                  <button
                    className="bg-gray-950 text-white rounded px-3 py-2 text-sm"
                    onClick={saveEdit}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            <h3 className="text-sm font-semibold mt-5 mb-2">{t('admin.leagues.requests')}</h3>
            <div className="grid gap-2">
              {(links[league.id] ?? []).map((link) => (
                <div
                  key={link.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-100 p-3 text-sm"
                >
                  <span>
                    {link.tournaments?.events?.name} - {link.tournaments?.name}
                  </span>
                  <span className="text-gray-500">
                    {t(`admin.leagues.linkStatuses.${link.status}`)}
                  </span>
                  {link.status === 'requested' && (
                    <span className="flex gap-2">
                      <button className="underline" onClick={() => review(link.id, 'approved')}>
                        {t('admin.leagues.approve')}
                      </button>
                      <button className="underline" onClick={() => review(link.id, 'rejected')}>
                        {t('admin.leagues.reject')}
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
