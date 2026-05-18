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

interface EventSummary {
  id: string;
  name: string;
  slug: string;
  start_date: string | null;
}

interface TournamentSummary {
  id: string;
  name: string | null;
  weapon: string | null;
  category: string | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `${fallback} (${res.status})`;
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown; code?: unknown };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
    if (typeof body.code === 'string' && body.code.trim()) return `${fallback} (${body.code})`;
  } catch {
    if (text.length < 180) return text;
  }
  return `${fallback} (${res.status})`;
}

async function expectOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

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
  const [addPanelLeagueId, setAddPanelLeagueId] = useState<string | null>(null);
  const [allEvents, setAllEvents] = useState<EventSummary[]>([]);
  const [eventSearch, setEventSearch] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [eventTournaments, setEventTournaments] = useState<Record<string, TournamentSummary[]>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.loadError'));
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
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.loadError'))))
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
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.createError'));
        setSlugDetached(false);
        setForm((current) => ({ ...current, name: '', slug: '' }));
        load();
      })
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.createError'))));
  };

  const review = (linkId: string, status: 'approved' | 'rejected') => {
    fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.reviewError'));
        load();
      })
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.reviewError'))));
  };

  const recompute = (leagueId: string) => {
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/recompute`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.recomputeError'));
        load();
      })
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.recomputeError'))));
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
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.updateError'));
        setEditId(null);
        load();
      })
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.updateError'))));
  };

  const deleteLeague = (leagueId: string, name: string) => {
    if (!window.confirm(`Delete league "${name}"? This cannot be undone.`)) return;
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.deleteError'));
        load();
      })
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.deleteError'))));
  };

  const removeLink = (linkId: string, leagueId: string) => {
    fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'removed' }),
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.removeLinkError'));
        return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
          credentials: 'include',
        });
      })
      .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
      .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.removeLinkError'))));
  };

  const removeEventLinks = (leagueId: string, eventId: string) => {
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/events/${eventId}/tournament-links`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.removeEventLinksError'));
        return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
          credentials: 'include',
        });
      })
      .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
      .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.removeEventLinksError'))));
  };

  const openAddPanel = (leagueId: string) => {
    if (addPanelLeagueId === leagueId) {
      setAddPanelLeagueId(null);
      return;
    }
    setAddPanelLeagueId(leagueId);
    setEventSearch('');
    setExpandedEventId(null);
    if (allEvents.length === 0) {
      fetch(`${apiUrl}/api/v1/events`, { credentials: 'include' })
        .then((res) => (res.ok ? (res.json() as Promise<EventSummary[]>) : []))
        .then(setAllEvents)
        .catch(() => setError(t('admin.leagues.loadEventsError')));
    }
  };

  const expandEvent = (eventId: string) => {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(eventId);
    if (!eventTournaments[eventId]) {
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, { credentials: 'include' })
        .then((res) => (res.ok ? (res.json() as Promise<TournamentSummary[]>) : []))
        .then((ts) => setEventTournaments((prev) => ({ ...prev, [eventId]: ts })))
        .catch(() => setError(t('admin.leagues.loadTournamentsError')));
    }
  };

  const addTournament = (leagueId: string, tournamentId: string) => {
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/link`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.addTournamentError'));
        return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
          credentials: 'include',
        });
      })
      .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
      .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
      .catch((err: unknown) => setError(errorText(err, t('admin.leagues.addTournamentError'))));
  };

  const addEventTournaments = (leagueId: string, eventId: string) => {
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/events/${eventId}/link`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        await expectOk(res, t('admin.leagues.addEventTournamentsError'));
        return fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
          credentials: 'include',
        });
      })
      .then((res) => (res.ok ? (res.json() as Promise<TournamentLink[]>) : []))
      .then((updated) => setLinks((prev) => ({ ...prev, [leagueId]: updated })))
      .catch((err: unknown) =>
        setError(errorText(err, t('admin.leagues.addEventTournamentsError'))),
      );
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
                  {editId === league.id ? t('admin.leagues.cancel') : t('admin.leagues.edit')}
                </button>
                <button
                  className="text-sm underline text-red-600"
                  onClick={() => deleteLeague(league.id, league.name)}
                >
                  {t('admin.leagues.delete')}
                </button>
                <button className="text-sm underline" onClick={() => openAddPanel(league.id)}>
                  {addPanelLeagueId === league.id
                    ? t('admin.leagues.closeAddPanel')
                    : t('admin.leagues.addTournaments')}
                </button>
              </div>
            </div>

            {editId === league.id && (
              <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4">
                <input
                  className="border rounded px-3 py-2 text-sm"
                  placeholder={t('admin.leagues.name')}
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
                <textarea
                  className="border rounded px-3 py-2 text-sm"
                  placeholder={t('admin.leagues.descriptionOptional')}
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
                    <option value="draft">{t('admin.leagues.draft')}</option>
                    <option value="published">{t('admin.leagues.published')}</option>
                    <option value="archived">{t('admin.leagues.archived')}</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.publicVisibility}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, publicVisibility: e.target.checked }))
                      }
                    />
                    {t('admin.leagues.public')}
                  </label>
                  <button
                    className="bg-gray-950 text-white rounded px-3 py-2 text-sm"
                    onClick={saveEdit}
                  >
                    {t('admin.leagues.save')}
                  </button>
                </div>
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    {t('admin.leagues.scoringSystem')}
                  </p>
                  <div className="flex gap-4 mb-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={editForm.scoringSystem === 'ffamhe_tf_2026'}
                        onChange={() =>
                          setEditForm((f) => ({
                            ...f,
                            scoringSystem: 'ffamhe_tf_2026',
                            pointRows: [],
                          }))
                        }
                      />
                      {t('admin.leagues.ffamhePreset')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={editForm.scoringSystem === 'custom'}
                        onChange={() =>
                          setEditForm((f) => ({
                            ...f,
                            scoringSystem: 'custom',
                            pointRows:
                              f.pointRows.length > 0
                                ? f.pointRows
                                : Object.entries(FFAMHE_POINTS).map(([rank, points]) => ({
                                    rank: Number(rank),
                                    points: Number(points),
                                  })),
                          }))
                        }
                      />
                      {t('admin.leagues.custom')}
                    </label>
                  </div>

                  {editForm.scoringSystem === 'custom' && (
                    <div>
                      <table className="text-sm w-full max-w-xs mb-2">
                        <thead>
                          <tr>
                            <th className="text-left px-2 py-1 text-xs text-gray-500">
                              {t('admin.leagues.rank')}
                            </th>
                            <th className="text-left px-2 py-1 text-xs text-gray-500">
                              {t('admin.leagues.points')}
                            </th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {editForm.pointRows.map((row, i) => (
                            <tr key={i}>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min={1}
                                  className="border rounded px-2 py-1 w-16 text-sm"
                                  value={row.rank}
                                  onChange={(e) => {
                                    const updated: Array<{ rank: number; points: number }> = [
                                      ...editForm.pointRows,
                                    ];
                                    updated[i] = {
                                      rank: Number(e.target.value),
                                      points: updated[i]!.points,
                                    };
                                    setEditForm((f) => ({ ...f, pointRows: updated }));
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  min={0}
                                  className="border rounded px-2 py-1 w-16 text-sm"
                                  value={row.points}
                                  onChange={(e) => {
                                    const updated: Array<{ rank: number; points: number }> = [
                                      ...editForm.pointRows,
                                    ];
                                    updated[i] = {
                                      rank: updated[i]!.rank,
                                      points: Number(e.target.value),
                                    };
                                    setEditForm((f) => ({ ...f, pointRows: updated }));
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <button
                                  className="text-red-500 text-xs underline"
                                  onClick={() =>
                                    setEditForm((f) => ({
                                      ...f,
                                      pointRows: f.pointRows.filter((_, j) => j !== i),
                                    }))
                                  }
                                >
                                  {t('admin.leagues.remove')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        className="text-sm underline"
                        onClick={() =>
                          setEditForm((f) => ({
                            ...f,
                            pointRows: [
                              ...f.pointRows,
                              { rank: f.pointRows.length + 1, points: 0 },
                            ],
                          }))
                        }
                      >
                        {t('admin.leagues.addRow')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(() => {
              const leagueLinks = links[league.id] ?? [];
              const byEvent = new Map<
                string,
                { eventId: string; eventName: string; links: TournamentLink[] }
              >();
              for (const link of leagueLinks) {
                const eventId = link.tournaments?.events?.id ?? '__no_event__';
                const eventName = link.tournaments?.events?.name ?? t('admin.leagues.unknownEvent');
                if (!byEvent.has(eventId)) byEvent.set(eventId, { eventId, eventName, links: [] });
                byEvent.get(eventId)!.links.push(link);
              }

              if (byEvent.size === 0) return null;

              return (
                <>
                  <h3 className="text-sm font-semibold mt-5 mb-2">{t('admin.leagues.requests')}</h3>
                  {[...byEvent.values()].map((group) => (
                    <div key={group.eventId} className="mb-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-600">{group.eventName}</span>
                        {group.eventId !== '__no_event__' && (
                          <button
                            className="text-xs underline text-red-600"
                            onClick={() => removeEventLinks(league.id, group.eventId)}
                          >
                            {t('admin.leagues.removeAll')}
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2">
                        {group.links.map((link) => (
                          <div
                            key={link.id}
                            className={`flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm ${
                              link.status === 'removed'
                                ? 'border-gray-100 opacity-40'
                                : 'border-gray-200'
                            }`}
                          >
                            <span>
                              {link.tournaments?.name}{' '}
                              {link.tournaments?.weapon && `· ${link.tournaments.weapon}`}{' '}
                              {link.tournaments?.category && `· ${link.tournaments.category}`}
                            </span>
                            <span className="text-gray-500 capitalize">{link.status}</span>
                            <span className="flex gap-2">
                              {link.status === 'requested' && (
                                <>
                                  <button
                                    className="underline"
                                    onClick={() => review(link.id, 'approved')}
                                  >
                                    {t('admin.leagues.approve')}
                                  </button>
                                  <button
                                    className="underline"
                                    onClick={() => review(link.id, 'rejected')}
                                  >
                                    {t('admin.leagues.reject')}
                                  </button>
                                </>
                              )}
                              {link.status !== 'removed' && (
                                <button
                                  className="underline text-red-600"
                                  onClick={() => removeLink(link.id, league.id)}
                                >
                                  {t('admin.leagues.remove')}
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}

            {addPanelLeagueId === league.id && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-sm font-semibold mb-2">{t('admin.leagues.addTournaments')}</p>
                <input
                  className="border rounded px-3 py-2 text-sm w-full max-w-sm mb-3"
                  placeholder={t('admin.leagues.searchEvents')}
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                />
                <div className="grid gap-2 max-h-72 overflow-y-auto">
                  {allEvents
                    .filter((ev) => !eventSearch || fuzzyMatch(eventSearch, ev.name))
                    .map((ev) => {
                      const linked = new Set(
                        (links[league.id] ?? [])
                          .filter((l) => l.status !== 'removed')
                          .map((l) => l.tournaments?.id)
                          .filter((id): id is string => Boolean(id)),
                      );
                      return (
                        <div key={ev.id} className="border border-gray-100 rounded p-2">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              className="text-sm text-left flex-1"
                              onClick={() => expandEvent(ev.id)}
                            >
                              {expandedEventId === ev.id ? '▾' : '▸'} {ev.name}
                            </button>
                            <button
                              className="text-xs underline"
                              onClick={() => addEventTournaments(league.id, ev.id)}
                            >
                              {t('admin.leagues.addAll')}
                            </button>
                          </div>
                          {expandedEventId === ev.id && (
                            <div className="mt-2 grid gap-1 pl-4">
                              {(eventTournaments[ev.id] ?? []).map((tour) => {
                                const isLinked = linked.has(tour.id);
                                return (
                                  <div
                                    key={tour.id}
                                    className={`flex items-center justify-between text-sm ${
                                      isLinked ? 'opacity-40' : ''
                                    }`}
                                  >
                                    <span>
                                      {tour.name}
                                      {tour.weapon ? ` · ${tour.weapon}` : ''}
                                      {tour.category ? ` · ${tour.category}` : ''}
                                    </span>
                                    <button
                                      className="text-xs underline"
                                      disabled={isLinked}
                                      onClick={() => !isLinked && addTournament(league.id, tour.id)}
                                    >
                                      {isLinked
                                        ? t('admin.leagues.linked')
                                        : t('admin.leagues.add')}
                                    </button>
                                  </div>
                                );
                              })}
                              {eventTournaments[ev.id]?.length === 0 && (
                                <p className="text-xs text-gray-400">
                                  {t('admin.leagues.noTournaments')}
                                </p>
                              )}
                              {!eventTournaments[ev.id] && (
                                <p className="text-xs text-gray-400">
                                  {t('admin.leagues.loading')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {allEvents.filter((ev) => !eventSearch || fuzzyMatch(eventSearch, ev.name))
                    .length === 0 && (
                    <p className="text-sm text-gray-400">
                      {t('admin.leagues.noEventsMatch', { query: eventSearch })}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
