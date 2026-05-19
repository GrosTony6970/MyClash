'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from '../league-utils';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface AdminUserOption {
  id: string;
  email?: string;
  display_name?: string | null;
  organizations?: Array<{ id: string; name: string; slug: string; role: string }>;
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
}

interface EventOption {
  id: string;
  name: string;
  slug: string;
  start_date: string | null;
}

interface TournamentOption {
  id: string;
  name: string | null;
  weapon: string | null;
  category: string | null;
}

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export default function NewLeaguePage() {
  const router = useRouter();

  // Basics
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDetached, setSlugDetached] = useState(false);
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()));
  const [rankingDimensions, setRankingDimensions] = useState<'weapon' | 'weapon_category'>(
    'weapon',
  );
  const [scoringSystem, setScoringSystem] = useState<'ffamhe_tf_2026' | 'custom'>('ffamhe_tf_2026');
  const [customPoints, setCustomPoints] = useState<Record<number, number>>(FFAMHE_POINTS);
  const [description, setDescription] = useState('');

  // Logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Owners
  const [users, setUsers] = useState<AdminUserOption[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Orgs
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);

  // Tournaments
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventQuery, setEventQuery] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [tournamentsByEvent, setTournamentsByEvent] = useState<Record<string, TournamentOption[]>>(
    {},
  );
  const [selectedTournaments, setSelectedTournaments] = useState<
    Array<{ tournamentId: string; tournamentName: string; eventName: string }>
  >([]);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugDetached) setSlug(toSlug(name));
  }, [name, slugDetached]);

  // Load lookup data
  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/admin/users?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users: AdminUserOption[] }) => setUsers(data.users ?? []))
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/organizations?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: OrgOption[] | { organizations: OrgOption[] }) =>
        setOrgs(Array.isArray(data) ? data : (data.organizations ?? [])),
      )
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/events?status=all`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: EventOption[]) => setEvents(data ?? []))
      .catch(() => undefined);
  }, []);

  function handleLogoFile(file: File | null) {
    setError(null);
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    if (!file) {
      setLogoFile(null);
      setLogoPreviewUrl(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError('Logo must be PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be 10 MB or smaller.');
      return;
    }
    setLogoFile(file);
    setLogoPreviewUrl(URL.createObjectURL(file));
  }

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users.slice(0, 50);
    return users
      .filter((u) => fuzzyMatch(userSearch, `${u.display_name ?? ''} ${u.email ?? ''}`))
      .slice(0, 50);
  }, [users, userSearch]);

  const filteredEvents = useMemo(() => {
    if (!eventQuery.trim()) return events.slice(0, 30);
    return events.filter((e) => fuzzyMatch(eventQuery, e.name)).slice(0, 30);
  }, [events, eventQuery]);

  async function loadEventTournaments(eventId: string) {
    if (tournamentsByEvent[eventId]) return;
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = (await res.json()) as TournamentOption[];
    setTournamentsByEvent((prev) => ({ ...prev, [eventId]: data }));
  }

  function pickTournament(t: TournamentOption, eventName: string) {
    if (selectedTournaments.some((x) => x.tournamentId === t.id)) return;
    setSelectedTournaments((prev) => [
      ...prev,
      { tournamentId: t.id, tournamentName: t.name ?? '(unnamed)', eventName },
    ]);
  }

  async function handleSubmit() {
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const scoringConfig: Record<string, unknown> = {
        scoringSystem,
        rankingDimensions,
        tieBreakers: [],
      };
      if (scoringSystem === 'custom') {
        scoringConfig['customPointsByRank'] = customPoints;
      }
      const createRes = await fetch(`${apiUrl}/api/v1/admin/leagues`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          seasonYear: parseInt(seasonYear, 10),
          description: description.trim() || undefined,
          scoringSystem,
          rankingDimensions,
          customPointsByRank: scoringSystem === 'custom' ? customPoints : undefined,
        }),
      });
      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Create failed');
      }
      const league = (await createRes.json()) as { id: string };
      const leagueId = league.id;

      // Logo upload
      if (logoFile) {
        const form = new FormData();
        form.set('file', logoFile);
        await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/logo`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
      }

      // Owners
      for (const userIdSel of selectedUserIds) {
        await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userIdSel, role: 'admin' }),
        });
      }

      // Orgs
      for (const orgId of selectedOrgIds) {
        await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: orgId, role: 'member' }),
        });
      }

      // Tournaments
      for (const t of selectedTournaments) {
        await fetch(
          `${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${t.tournamentId}/link`,
          {
            method: 'POST',
            credentials: 'include',
          },
        );
      }

      router.push(`/admin/leagues/${leagueId}/edit?created=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-2 text-sm">
        <Link href="/admin/leagues" className="text-slate-500 hover:underline">
          Back to leagues
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create league</h1>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Basics
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            Name *
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Year *
            <input
              type="number"
              value={seasonYear}
              onChange={(e) => setSeasonYear(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Slug *
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugDetached(true);
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              Auto-generated from the name. Edit manually to override.
            </span>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Category
            <select
              value={rankingDimensions}
              onChange={(e) => setRankingDimensions(e.target.value as 'weapon' | 'weapon_category')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="weapon">Weapon</option>
              <option value="weapon_category">Weapon + Category</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Scoring system
            <select
              value={scoringSystem}
              onChange={(e) => setScoringSystem(e.target.value as 'ffamhe_tf_2026' | 'custom')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="ffamhe_tf_2026">FFAMHE TF 2026 (default)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
        </div>

        {scoringSystem === 'custom' && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-600 mb-2">Points by rank</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {Object.entries(customPoints).map(([rank, points]) => (
                <label key={rank} className="text-[11px] text-slate-500">
                  Rank {rank}
                  <input
                    type="number"
                    value={points}
                    onChange={(e) =>
                      setCustomPoints((prev) => ({
                        ...prev,
                        [Number(rank)]: Number(e.target.value),
                      }))
                    }
                    className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Logo (optional)
        </h2>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
        />
        <p className="mt-1 text-[11px] text-slate-500">PNG, JPEG, or WebP. Maximum 10 MB.</p>
        {logoPreviewUrl && (
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoPreviewUrl}
              alt="Preview"
              className="h-20 w-20 rounded-md border border-slate-200 bg-white object-contain"
            />
            <button
              type="button"
              onClick={() => handleLogoFile(null)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Owner platform accounts
        </h2>
        <input
          type="search"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        {filteredUsers.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-gray-200">
            {filteredUsers.map((u) => {
              const checked = selectedUserIds.includes(u.id);
              return (
                <label
                  key={u.id}
                  className={[
                    'flex cursor-pointer items-start gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-0',
                    checked ? 'bg-blue-50' : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedUserIds((prev) =>
                        prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id],
                      )
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">
                      {u.display_name?.trim() || '(no name)'}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                    {(u.organizations ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(u.organizations ?? []).slice(0, 3).map((o) => (
                          <span
                            key={o.id}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px]"
                          >
                            {o.name} · {o.role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Member organisations
        </h2>
        <div className="grid gap-1 sm:grid-cols-2 max-h-60 overflow-y-auto">
          {orgs.map((o) => {
            const checked = selectedOrgIds.includes(o.id);
            return (
              <label
                key={o.id}
                className={[
                  'flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm',
                  checked ? 'border-blue-200 bg-blue-50' : 'border-gray-200 hover:bg-gray-50',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelectedOrgIds((prev) =>
                      prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id],
                    )
                  }
                />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Linked tournaments
        </h2>
        <input
          type="search"
          value={eventQuery}
          onChange={(e) => setEventQuery(e.target.value)}
          placeholder="Search events…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {filteredEvents.length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-gray-200">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="border-b border-gray-100 last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedEventId(expandedEventId === ev.id ? null : ev.id);
                    void loadEventTournaments(ev.id);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-slate-900">{ev.name}</span>
                  <span className="text-xs text-slate-400">
                    {expandedEventId === ev.id ? '−' : '+'}
                  </span>
                </button>
                {expandedEventId === ev.id && (
                  <div className="border-t border-gray-100 bg-slate-50 px-3 py-2">
                    {(tournamentsByEvent[ev.id] ?? []).length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No tournaments.</p>
                    ) : (
                      <ul className="space-y-1">
                        {(tournamentsByEvent[ev.id] ?? []).map((t) => {
                          const picked = selectedTournaments.some((x) => x.tournamentId === t.id);
                          return (
                            <li
                              key={t.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span>
                                {t.name ?? '(unnamed)'}{' '}
                                {t.weapon && <span className="text-slate-400">· {t.weapon}</span>}
                              </span>
                              <button
                                type="button"
                                disabled={picked}
                                onClick={() => pickTournament(t, ev.name)}
                                className={[
                                  'rounded px-2 py-0.5 font-semibold',
                                  picked
                                    ? 'bg-slate-100 text-slate-400'
                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200',
                                ].join(' ')}
                              >
                                {picked ? 'Added' : 'Add'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {selectedTournaments.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600 mb-1">
              Selected ({selectedTournaments.length}):
            </p>
            <ul className="space-y-1">
              {selectedTournaments.map((t) => (
                <li
                  key={t.tournamentId}
                  className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs"
                >
                  <span>
                    {t.tournamentName} <span className="text-slate-400">· {t.eventName}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTournaments((prev) =>
                        prev.filter((x) => x.tournamentId !== t.tournamentId),
                      )
                    }
                    className="text-red-700 hover:text-red-900"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-3">
        <Link
          href="/admin/leagues"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !name.trim() || !slug.trim()}
          className="rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create league'}
        </button>
      </div>
    </main>
  );
}
