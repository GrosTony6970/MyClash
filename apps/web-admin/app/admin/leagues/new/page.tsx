'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from '../league-utils';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

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
  status: string | null;
}

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export default function NewLeaguePage() {
  const { t } = useI18n();
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
    Array<{
      tournamentId: string;
      tournamentName: string;
      eventName: string;
      groupTmpId: string | null;
    }>
  >([]);

  // Groups (created together with the league after submit). Each entry
  // carries a local tmpId used to attach selected tournaments to a group
  // before the league exists; the tmpId is swapped for the real UUID
  // once the POST /groups returns.
  const [leagueGroups, setLeagueGroups] = useState<
    Array<{ tmpId: string; name: string; sortOrder: number }>
  >([]);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addGroup() {
    setLeagueGroups((prev) => [
      ...prev,
      {
        tmpId: `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        sortOrder: prev.length,
      },
    ]);
  }
  function updateGroupName(tmpId: string, name: string) {
    setLeagueGroups((prev) => prev.map((g) => (g.tmpId === tmpId ? { ...g, name } : g)));
  }
  function removeGroup(tmpId: string) {
    setLeagueGroups((prev) => prev.filter((g) => g.tmpId !== tmpId));
    setSelectedTournaments((prev) =>
      prev.map((t) => (t.groupTmpId === tmpId ? { ...t, groupTmpId: null } : t)),
    );
  }
  function setTournamentGroup(tournamentId: string, groupTmpId: string | null) {
    setSelectedTournaments((prev) =>
      prev.map((t) => (t.tournamentId === tournamentId ? { ...t, groupTmpId } : t)),
    );
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derives slug from name until the user manually overrides it
    if (!slugDetached) setSlug(toSlug(name));
  }, [name, slugDetached]);

  // Load lookup data
  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/admin/users?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users: AdminUserOption[] }) => setUsers(data.users ?? []))
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/organizations?perPage=200&excludePlatform=true`, {
      credentials: 'include',
    })
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
      setError(t('admin.common.logoTypeInvalid'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('admin.common.logoTooLarge'));
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
    const defaultGroup = leagueGroups[0]?.tmpId ?? null;
    setSelectedTournaments((prev) => [
      ...prev,
      {
        tournamentId: t.id,
        tournamentName: t.name ?? '(unnamed)',
        eventName,
        groupTmpId: defaultGroup,
      },
    ]);
  }

  async function handleSubmit() {
    if (!name.trim() || !slug.trim()) {
      setError(t('admin.common.nameAndSlugRequired'));
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
        throw new Error(body.message ?? t('admin.common.createFailed'));
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

      // Groups (must be created before tournament links so the link
      // POSTs can reference the new group ids). Local entries carry a
      // temporary `tmpId` used by the tournament picker to choose a
      // group; we map that to the real UUID once the group is created.
      const groupIdByTmp = new Map<string, string>();
      for (const g of leagueGroups) {
        if (!g.name.trim()) continue;
        const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/groups`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: g.name.trim(), sortOrder: g.sortOrder }),
        });
        if (res.ok) {
          const created = (await res.json()) as { id: string };
          groupIdByTmp.set(g.tmpId, created.id);
        }
      }

      // Tournaments
      for (const t of selectedTournaments) {
        const resolvedGroupId = t.groupTmpId ? (groupIdByTmp.get(t.groupTmpId) ?? null) : null;
        await fetch(
          `${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${t.tournamentId}/link`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: resolvedGroupId }),
          },
        );
      }

      router.push(`/admin/leagues/${leagueId}/edit?created=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-2 text-sm">
        <Link href="/admin/leagues" className="text-muted hover:underline">
          {t('admin.adminLeagues.backToLeagues')}
        </Link>
      </div>
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-6">
        {t('admin.adminLeagues.newPageTitle')}
      </h1>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.basicsHeading')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.adminLeagues.nameLabel')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.adminLeagues.yearLabel')}
            <input
              type="number"
              value={seasonYear}
              onChange={(e) => setSeasonYear(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="text-xs font-medium text-foreground-secondary sm:col-span-2">
            {t('admin.adminLeagues.slugLabel')}
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugDetached(true);
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <span className="mt-1 block text-[11px] font-normal text-muted">
              {t('admin.adminLeagues.slugHelp')}
            </span>
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.adminLeagues.categoryLabel')}
            <select
              value={rankingDimensions}
              onChange={(e) => setRankingDimensions(e.target.value as 'weapon' | 'weapon_category')}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="weapon">{t('admin.adminLeagues.categoryWeapon')}</option>
              <option value="weapon_category">
                {t('admin.adminLeagues.categoryWeaponCategory')}
              </option>
            </select>
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.adminLeagues.scoringSystemLabel')}
            <select
              value={scoringSystem}
              onChange={(e) => setScoringSystem(e.target.value as 'ffamhe_tf_2026' | 'custom')}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="ffamhe_tf_2026">
                {t('admin.adminLeagues.scoringSystemFfamheDefault')}
              </option>
              <option value="custom">{t('admin.adminLeagues.scoringSystemCustom')}</option>
            </select>
          </label>
          <label className="text-xs font-medium text-foreground-secondary sm:col-span-2">
            {t('admin.adminLeagues.descriptionLabel')}
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>

        {scoringSystem === 'custom' && (
          <div className="mt-4">
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {t('admin.adminLeagues.pointsByRank')}
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {Object.entries(customPoints).map(([rank, points]) => (
                <label key={rank} className="text-[11px] text-muted">
                  {t('admin.adminLeagues.rankLabel', { rank })}
                  <input
                    type="number"
                    value={points}
                    onChange={(e) =>
                      setCustomPoints((prev) => ({
                        ...prev,
                        [Number(rank)]: Number(e.target.value),
                      }))
                    }
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.logoHeading')}
        </h2>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-border px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground-secondary hover:file:bg-background"
        />
        <p className="mt-1 text-[11px] text-muted">{t('admin.adminLeagues.logoHint')}</p>
        {logoPreviewUrl && (
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoPreviewUrl}
              alt={t('admin.adminLeagues.logoPreviewAlt')}
              className="h-20 w-20 rounded-md border border-border bg-surface object-contain"
            />
            <button
              type="button"
              onClick={() => handleLogoFile(null)}
              className="text-xs text-muted hover:text-foreground"
            >
              {t('admin.adminLeagues.clearButton')}
            </button>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.ownersHeading')}
        </h2>
        <input
          type="search"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder={t('admin.adminLeagues.userSearchPlaceholder')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {filteredUsers.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
            {filteredUsers.map((u) => {
              const checked = selectedUserIds.includes(u.id);
              return (
                <label
                  key={u.id}
                  className={[
                    'flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 text-sm last:border-0',
                    checked ? 'bg-info/10' : 'hover:bg-background',
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
                    <p className="font-medium text-foreground">
                      {u.display_name?.trim() || '(no name)'}
                    </p>
                    <p className="text-xs text-muted">{u.email}</p>
                    {(u.organizations ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(u.organizations ?? []).slice(0, 3).map((o) => (
                          <span
                            key={o.id}
                            className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px]"
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

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.memberOrgsHeading')}
        </h2>
        <div className="grid gap-1 sm:grid-cols-2 max-h-60 overflow-y-auto">
          {orgs.map((o) => {
            const checked = selectedOrgIds.includes(o.id);
            return (
              <label
                key={o.id}
                className={[
                  'flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm',
                  checked ? 'border-info/30 bg-info/10' : 'border-border hover:bg-background',
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

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.groupsHeading')}
        </h2>
        <p className="mb-3 text-xs text-muted">{t('admin.adminLeagues.groupsHelp')}</p>
        <div className="space-y-2">
          {leagueGroups.map((g) => (
            <div key={g.tmpId} className="flex items-center gap-2">
              <input
                type="text"
                value={g.name}
                onChange={(e) => updateGroupName(g.tmpId, e.target.value)}
                placeholder={t('admin.adminLeagues.groupNamePlaceholder')}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => removeGroup(g.tmpId)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground-secondary hover:bg-background"
              >
                {t('admin.adminLeagues.removeButton')}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addGroup}
          className="mt-3 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:bg-background"
        >
          {t('admin.adminLeagues.addGroupButton')}
        </button>
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.linkedTournamentsHeading')}
        </h2>
        <input
          type="search"
          value={eventQuery}
          onChange={(e) => setEventQuery(e.target.value)}
          placeholder={t('admin.adminLeagues.eventSearchPlaceholder')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
        {filteredEvents.length > 0 && (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedEventId(expandedEventId === ev.id ? null : ev.id);
                    void loadEventTournaments(ev.id);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-background"
                >
                  <span className="font-medium text-foreground">{ev.name}</span>
                  <span className="text-xs text-muted">
                    {expandedEventId === ev.id ? '−' : '+'}
                  </span>
                </button>
                {expandedEventId === ev.id && (
                  <div className="border-t border-border bg-background px-3 py-2">
                    {(tournamentsByEvent[ev.id] ?? []).length === 0 ? (
                      <p className="text-xs text-muted italic">
                        {t('admin.adminLeagues.noTournaments')}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {(tournamentsByEvent[ev.id] ?? []).map((t) => {
                          const picked = selectedTournaments.some((x) => x.tournamentId === t.id);
                          return (
                            <li
                              key={t.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="flex items-center gap-1.5">
                                <span>{t.name ?? '(unnamed)'}</span>
                                {t.weapon && <span className="text-muted">· {t.weapon}</span>}
                                {t.status && (
                                  <span
                                    className={[
                                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                      t.status === 'published'
                                        ? 'bg-success/10 text-success'
                                        : t.status === 'draft'
                                          ? 'bg-warning/10 text-warning'
                                          : t.status === 'completed'
                                            ? 'bg-background text-foreground-secondary'
                                            : 'bg-background text-muted',
                                    ].join(' ')}
                                  >
                                    {t.status}
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                disabled={picked}
                                onClick={() => pickTournament(t, ev.name)}
                                className={[
                                  'rounded px-2 py-0.5 font-semibold',
                                  picked
                                    ? 'bg-background text-muted'
                                    : 'bg-info/10 text-info hover:bg-info/20',
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
            <p className="text-xs font-medium text-foreground-secondary mb-1">
              {t('admin.adminLeagues.selectedCount', { count: selectedTournaments.length })}
            </p>
            <ul className="space-y-1">
              {selectedTournaments.map((sel) => (
                <li
                  key={sel.tournamentId}
                  className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
                >
                  <span className="flex-1 truncate">
                    {sel.tournamentName} <span className="text-muted">· {sel.eventName}</span>
                  </span>
                  {leagueGroups.length > 0 && (
                    <select
                      value={sel.groupTmpId ?? ''}
                      onChange={(e) => setTournamentGroup(sel.tournamentId, e.target.value || null)}
                      className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs"
                    >
                      <option value="">{t('admin.adminLeagues.noGroupOption')}</option>
                      {leagueGroups.map((g) => (
                        <option key={g.tmpId} value={g.tmpId}>
                          {g.name.trim() || '(unnamed)'}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTournaments((prev) =>
                        prev.filter((x) => x.tournamentId !== sel.tournamentId),
                      )
                    }
                    className="text-danger hover:text-danger"
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
          className="rounded-md border border-border px-4 py-2 text-sm text-foreground-secondary hover:bg-background"
        >
          {t('admin.adminLeagues.cancelButton')}
        </Link>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !name.trim() || !slug.trim()}
          className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create league'}
        </button>
      </div>
    </main>
  );
}
