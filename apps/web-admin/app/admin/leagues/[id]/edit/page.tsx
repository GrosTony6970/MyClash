'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FFAMHE_POINTS, fuzzyMatch } from '../../league-utils';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface League {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  season_year: number;
  status: string;
  public_visibility: boolean;
  logo_url: string | null;
  scoring_system: string;
  scoring_config: {
    scoringSystem?: 'ffamhe_tf_2026' | 'custom';
    rankingDimensions?: 'weapon' | 'weapon_category';
    customPointsByRank?: Record<number, number>;
    tieBreakers?: string[];
  } | null;
}

interface UserRoleRow {
  userId: string;
  role: string;
  displayName: string | null;
  email: string | null;
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
}

interface OrgRoleRow {
  organizationId: string;
  role: string;
  name: string;
  slug: string;
}

interface TournamentLink {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'removed';
  tournaments?: {
    id?: string | null;
    name?: string | null;
    weapon?: string | null;
    events?: { id?: string | null; name?: string | null } | null;
  } | null;
}

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
}

interface TournamentOption {
  id: string;
  name: string | null;
  weapon: string | null;
}

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export default function EditLeaguePage() {
  const params = useParams<{ id: string }>();
  const leagueId = params.id;
  const searchParams = useSearchParams();
  const justCreated = searchParams.get('created') === '1';

  const [league, setLeague] = useState<League | null>(null);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [orgRoles, setOrgRoles] = useState<OrgRoleRow[]>([]);
  const [tournamentLinks, setTournamentLinks] = useState<TournamentLink[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserOption[]>([]);
  const [allOrgs, setAllOrgs] = useState<OrgOption[]>([]);
  const [allEvents, setAllEvents] = useState<EventOption[]>([]);

  // Form state mirrors league
  const [name, setName] = useState('');
  const [seasonYear, setSeasonYear] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [publicVisibility, setPublicVisibility] = useState(false);
  const [rankingDimensions, setRankingDimensions] = useState<'weapon' | 'weapon_category'>(
    'weapon',
  );
  const [scoringSystem, setScoringSystem] = useState<'ffamhe_tf_2026' | 'custom'>('ffamhe_tf_2026');
  const [customPoints, setCustomPoints] = useState<Record<number, number>>(FFAMHE_POINTS);

  // Add forms
  const [userSearch, setUserSearch] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [tournamentsByEvent, setTournamentsByEvent] = useState<Record<string, TournamentOption[]>>(
    {},
  );

  // UI state
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLeague = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load league');
    const data = (await res.json()) as League[];
    const found = data.find((l) => l.id === leagueId);
    if (!found) throw new Error('League not found');
    setLeague(found);
    setName(found.name);
    setSeasonYear(String(found.season_year));
    setDescription(found.description ?? '');
    setStatus(found.status);
    setPublicVisibility(found.public_visibility);
    setRankingDimensions(found.scoring_config?.rankingDimensions ?? 'weapon');
    setScoringSystem(found.scoring_config?.scoringSystem ?? 'ffamhe_tf_2026');
    if (found.scoring_config?.customPointsByRank) {
      setCustomPoints(found.scoring_config.customPointsByRank);
    }
  }, [leagueId]);

  const loadAssignments = useCallback(async () => {
    const [usersRes, orgsRes, linksRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
        credentials: 'include',
      }),
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      }),
    ]);
    if (usersRes.ok) setUserRoles(((await usersRes.json()) as UserRoleRow[]) ?? []);
    if (orgsRes.ok) setOrgRoles(((await orgsRes.json()) as OrgRoleRow[]) ?? []);
    if (linksRes.ok) {
      const data = (await linksRes.json()) as TournamentLink[];
      setTournamentLinks(data.filter((l) => l.status !== 'removed'));
    }
  }, [leagueId]);

  useEffect(() => {
    void loadLeague().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load league');
    });
    void loadAssignments().catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/users?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users: AdminUserOption[] }) => setAllUsers(data.users ?? []))
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/organizations?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: OrgOption[] | { organizations: OrgOption[] }) =>
        setAllOrgs(Array.isArray(data) ? data : (data.organizations ?? [])),
      )
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/events?status=all`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: EventOption[]) => setAllEvents(data ?? []))
      .catch(() => undefined);
  }, [loadLeague, loadAssignments]);

  const filteredUsers = useMemo(() => {
    const taken = new Set(userRoles.map((r) => r.userId));
    return allUsers
      .filter((u) => !taken.has(u.id))
      .filter((u) =>
        userSearch.trim()
          ? fuzzyMatch(userSearch, `${u.display_name ?? ''} ${u.email ?? ''}`)
          : true,
      )
      .slice(0, 30);
  }, [allUsers, userRoles, userSearch]);

  const availableOrgs = useMemo(() => {
    const taken = new Set(orgRoles.map((r) => r.organizationId));
    return allOrgs.filter((o) => !taken.has(o.id));
  }, [allOrgs, orgRoles]);

  const filteredEvents = useMemo(() => {
    if (!eventQuery.trim()) return allEvents.slice(0, 30);
    return allEvents.filter((e) => fuzzyMatch(eventQuery, e.name)).slice(0, 30);
  }, [allEvents, eventQuery]);

  async function loadEventTournaments(eventId: string) {
    if (tournamentsByEvent[eventId]) return;
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = (await res.json()) as TournamentOption[];
    setTournamentsByEvent((prev) => ({ ...prev, [eventId]: data }));
  }

  function flashSaved(message: string) {
    setSavedFlash(message);
    setTimeout(() => setSavedFlash(null), 2500);
  }

  async function saveBasics() {
    setBusy(true);
    setError(null);
    try {
      const scoringConfig: Record<string, unknown> = {
        scoringSystem,
        rankingDimensions,
        tieBreakers: league?.scoring_config?.tieBreakers ?? [],
      };
      if (scoringSystem === 'custom') {
        scoringConfig['customPointsByRank'] = customPoints;
      }
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          status,
          publicVisibility,
          scoringConfig,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Save failed');
      }
      flashSaved('Saved');
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError('Logo must be PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo must be 10 MB or smaller.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/logo`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Logo upload failed');
      }
      flashSaved('Logo uploaded');
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm('Remove logo?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/logo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Remove failed');
      flashSaved('Logo removed');
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  async function addOwner(userIdSel: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userIdSel, role: 'admin' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Add failed');
      }
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeOwner(userIdSel: string) {
    if (!window.confirm('Detach this account from the league?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles/${userIdSel}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Detach failed');
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detach failed');
    } finally {
      setBusy(false);
    }
  }

  async function addOrg(orgId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, role: 'member' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Add failed');
      }
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeOrg(orgId: string) {
    if (!window.confirm('Detach this organisation from the league?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles/${orgId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Detach failed');
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detach failed');
    } finally {
      setBusy(false);
    }
  }

  async function addTournamentLink(tournamentId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/link`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Add failed');
      }
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeTournamentLink(linkId: string) {
    if (!window.confirm('Detach this tournament from the league?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'removed' }),
      });
      if (!res.ok) throw new Error('Detach failed');
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detach failed');
    } finally {
      setBusy(false);
    }
  }

  if (!league) {
    return (
      <main className="p-8">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Loading…</p>
        )}
      </main>
    );
  }

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-2 text-sm">
        <Link href="/admin/leagues" className="text-slate-500 hover:underline">
          Back to leagues
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Edit league</h1>

      {justCreated && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          League created. You can now adjust everything below.
        </div>
      )}
      {savedFlash && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {savedFlash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Basics */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Basics
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Year (read-only)
            <input
              value={seasonYear}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 bg-slate-50 px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Slug (read-only)
            <input
              value={league.slug}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 bg-slate-50 px-3 py-2 text-sm font-mono"
            />
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
              <option value="ffamhe_tf_2026">FFAMHE TF 2026</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="flex items-end gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={publicVisibility}
              onChange={(e) => setPublicVisibility(e.target.checked)}
            />
            Public visibility
          </label>
          <label className="text-xs font-medium text-slate-600 sm:col-span-2">
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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

        <button
          type="button"
          onClick={() => void saveBasics()}
          disabled={busy}
          className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          Save basics
        </button>
      </section>

      {/* Logo */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Logo</h2>
        <div className="flex items-center gap-4">
          {league.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={league.logo_url}
              alt={league.name}
              className="h-24 w-24 rounded-md border border-slate-200 bg-white object-contain"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-lg font-bold text-slate-500">
              {league.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadLogo(f);
              }}
              disabled={busy}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">PNG, JPEG, or WebP. Maximum 10 MB.</p>
            {league.logo_url && (
              <button
                type="button"
                onClick={() => void removeLogo()}
                disabled={busy}
                className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Remove logo
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Owner accounts */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Owner platform accounts
        </h2>
        {userRoles.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No accounts linked yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {userRoles.map((r) => (
              <li key={r.userId} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-900">
                    {r.displayName || '(no name)'}
                    <span className="ml-2 text-xs font-normal text-slate-400">{r.role}</span>
                  </p>
                  <p className="text-xs text-slate-500">{r.email}</p>
                  {r.organizations.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.organizations.slice(0, 3).map((o) => (
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
                <button
                  type="button"
                  onClick={() => void removeOwner(r.userId)}
                  disabled={busy}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 pt-4">
          <input
            type="search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search accounts to add…"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {filteredUsers.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-gray-200">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void addOwner(u.id)}
                  disabled={busy}
                  className="block w-full text-left border-b border-gray-100 px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-50 last:border-0"
                >
                  <span className="font-medium">{u.display_name || '(no name)'}</span>
                  <span className="ml-2 text-xs text-slate-500">{u.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Orgs */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Member organisations
        </h2>
        {orgRoles.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No orgs linked yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {orgRoles.map((r) => (
              <li
                key={r.organizationId}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="font-mono text-xs text-slate-400">{r.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{r.role}</span>
                  <button
                    type="button"
                    onClick={() => void removeOrg(r.organizationId)}
                    disabled={busy}
                    className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Detach
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {availableOrgs.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-600 mb-2">Add organisation</p>
            <div className="grid gap-1 sm:grid-cols-2 max-h-40 overflow-y-auto">
              {availableOrgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => void addOrg(o.id)}
                  disabled={busy}
                  className="rounded border border-gray-200 px-3 py-1.5 text-left text-sm hover:bg-blue-50 disabled:opacity-50"
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Tournaments */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Linked tournaments
        </h2>
        {tournamentLinks.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No tournaments linked yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {tournamentLinks.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {link.tournaments?.name ?? '(unnamed)'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {link.tournaments?.events?.name ?? ''}{' '}
                    {link.tournaments?.weapon && (
                      <span className="text-slate-400">· {link.tournaments.weapon}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {link.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeTournamentLink(link.id)}
                    disabled={busy}
                    className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Detach
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-600 mb-2">Add a tournament</p>
          <input
            type="search"
            value={eventQuery}
            onChange={(e) => setEventQuery(e.target.value)}
            placeholder="Search events…"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {filteredEvents.length > 0 && (
            <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-gray-200">
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
                            const already = tournamentLinks.some((l) => l.tournaments?.id === t.id);
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
                                  disabled={already || busy}
                                  onClick={() => void addTournamentLink(t.id)}
                                  className={[
                                    'rounded px-2 py-0.5 font-semibold',
                                    already
                                      ? 'bg-slate-100 text-slate-400'
                                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200',
                                  ].join(' ')}
                                >
                                  {already ? 'Linked' : 'Add'}
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
        </div>
      </section>
    </main>
  );
}
