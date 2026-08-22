'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { LeagueRankingDimensions as RankingDimensions } from '@myclash/types';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from '../league-utils';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import {
  ACCOUNT_SEARCH_MIN_LENGTH,
  useAccountSearch,
  type AccountSearchResult,
} from '@/hooks/useAccountSearch';

const apiUrl = getPublicApiUrl();

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
  const [rankingDimensions, setRankingDimensions] = useState<RankingDimensions>('weapon');
  const [scoringSystem, setScoringSystem] = useState<'ffamhe_tf_2026' | 'custom'>('ffamhe_tf_2026');
  const [customPoints, setCustomPoints] = useState<Record<number, number>>(FFAMHE_POINTS);
  const [description, setDescription] = useState('');

  // Logo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Owners. Selected accounts are kept whole, not as ids: the picker searches
  // server-side, so a result row disappears as soon as the query changes and
  // the chips above the search box are the only thing left rendering a choice.
  const [userSearch, setUserSearch] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<AccountSearchResult[]>([]);

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

  // Load lookup data. Both pickers stay empty on a refusal, as before: this
  // page reports on the CREATE, and an empty picker is visible on its own.
  useEffect(() => {
    void apiRequest<OrgOption[] | { organizations: OrgOption[] }>(
      apiUrl,
      '/api/v1/admin/organizations?perPage=200&excludePlatform=true',
    ).then((r) => {
      if (!r.ok) return;
      setOrgs(Array.isArray(r.data) ? r.data : (r.data.organizations ?? []));
    });
    void apiRequest<EventOption[]>(apiUrl, '/api/v1/events?status=all').then((r) => {
      if (r.ok) setEvents(r.data ?? []);
    });
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

  const { accounts: accountMatches, loading: accountsLoading } = useAccountSearch(userSearch);

  const filteredUsers = useMemo(() => {
    const taken = new Set(selectedAccounts.map((a) => a.id));
    return accountMatches.filter((u) => !taken.has(u.id));
  }, [accountMatches, selectedAccounts]);

  const anyResultIsOrgLinked = filteredUsers.some((u) => (u.organizations ?? []).length > 0);

  const filteredEvents = useMemo(() => {
    if (!eventQuery.trim()) return events.slice(0, 30);
    return events.filter((e) => fuzzyMatch(eventQuery, e.name)).slice(0, 30);
  }, [events, eventQuery]);

  async function loadEventTournaments(eventId: string) {
    if (tournamentsByEvent[eventId]) return;
    const r = await apiRequest<TournamentOption[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`);
    if (!r.ok) return;
    setTournamentsByEvent((prev) => ({ ...prev, [eventId]: r.data }));
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
      const created = await apiRequest<{ id: string }>(apiUrl, '/api/v1/admin/leagues', {
        method: 'POST',
        body: {
          name: name.trim(),
          slug: slug.trim(),
          seasonYear: parseInt(seasonYear, 10),
          description: description.trim() || undefined,
          scoringSystem,
          rankingDimensions,
          customPointsByRank: scoringSystem === 'custom' ? customPoints : undefined,
        },
      });
      if (!created.ok) {
        const message = failureMessage(created, t, t('admin.common.createFailed'));
        if (message) setError(message);
        return;
      }
      const leagueId = created.data.id;

      // Everything below is a follow-up write on a league that already exists,
      // and every one of them still discards its refusal. That is unchanged
      // here on purpose: the operator lands on the edit page, which lists the
      // logo, the owners, the orgs, the groups and the linked tournaments, so a
      // dropped step is visible there. Naming it rather than hiding it.

      // Logo upload
      if (logoFile) {
        const form = new FormData();
        form.set('file', logoFile);
        await apiRequest(apiUrl, `/api/v1/admin/leagues/${leagueId}/logo`, {
          method: 'POST',
          body: form,
        });
      }

      // Owners
      for (const userIdSel of selectedAccounts.map((a) => a.id)) {
        await apiRequest(apiUrl, `/api/v1/admin/leagues/${leagueId}/user-roles`, {
          method: 'POST',
          body: { userId: userIdSel, role: 'admin' },
        });
      }

      // Orgs
      for (const orgId of selectedOrgIds) {
        await apiRequest(apiUrl, `/api/v1/admin/leagues/${leagueId}/organization-roles`, {
          method: 'POST',
          body: { organizationId: orgId, role: 'member' },
        });
      }

      // Groups (must be created before tournament links so the link
      // POSTs can reference the new group ids). Local entries carry a
      // temporary `tmpId` used by the tournament picker to choose a
      // group; we map that to the real UUID once the group is created.
      const groupIdByTmp = new Map<string, string>();
      for (const g of leagueGroups) {
        if (!g.name.trim()) continue;
        const group = await apiRequest<{ id: string }>(
          apiUrl,
          `/api/v1/admin/leagues/${leagueId}/groups`,
          { method: 'POST', body: { name: g.name.trim(), sortOrder: g.sortOrder } },
        );
        if (group.ok) groupIdByTmp.set(g.tmpId, group.data.id);
      }

      // Tournaments
      for (const t of selectedTournaments) {
        const resolvedGroupId = t.groupTmpId ? (groupIdByTmp.get(t.groupTmpId) ?? null) : null;
        await apiRequest(
          apiUrl,
          `/api/v1/admin/leagues/${leagueId}/tournaments/${t.tournamentId}/link`,
          { method: 'POST', body: { groupId: resolvedGroupId } },
        );
      }

      router.push(`/admin/leagues/${leagueId}/edit?created=1`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="p-8 max-w-4xl">
      <BackLink
        href="/admin/leagues"
        label={t('admin.adminLeagues.backToLeagues')}
        className="mb-2"
      />
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
            {t('admin.adminLeagues.rankingDimensionLabel')}
            <select
              value={rankingDimensions}
              onChange={(e) => setRankingDimensions(e.target.value as RankingDimensions)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="weapon">{t('admin.adminLeagues.rankingDimensionWeapon')}</option>
              <option value="weapon_category">
                {t('admin.adminLeagues.rankingDimensionWeaponGroup')}
              </option>
              <option value="group">{t('admin.adminLeagues.rankingDimensionGroup')}</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-muted">
              {t('admin.adminLeagues.rankingDimensionHelp')}
            </span>
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
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.ownersHeading')}
        </h2>
        <p className="mb-4 text-xs text-muted">{t('admin.adminLeagues.ownersDescription')}</p>
        {selectedAccounts.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedAccounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  setSelectedAccounts((prev) => prev.filter((prevAcc) => prevAcc.id !== a.id))
                }
                className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs hover:border-danger/40 hover:text-danger"
                title={t('admin.adminLeagues.ownerRemoveHint')}
              >
                <span className="font-medium">
                  {a.display_name?.trim() || a.email || t('admin.adminLeagues.userNameFallback')}
                </span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
        <input
          type="search"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder={t('admin.adminLeagues.userSearchPlaceholder')}
          className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {filteredUsers.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedAccounts((prev) => [...prev, u])}
                className="block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-info/10 last:border-0"
              >
                <span className="font-medium text-foreground">
                  {u.display_name?.trim() || t('admin.adminLeagues.userNameFallback')}
                </span>
                <span className="ml-2 text-xs text-muted">{u.email}</span>
                {(u.organizations ?? []).length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {(u.organizations ?? []).slice(0, 3).map((o) => (
                      <span
                        key={o.id}
                        className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px]"
                      >
                        {o.name} · {o.role}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {userSearch.trim().length < ACCOUNT_SEARCH_MIN_LENGTH ? (
          <p className="mt-2 text-xs text-muted">{t('admin.adminLeagues.userSearchHint')}</p>
        ) : accountsLoading ? (
          <p className="mt-2 text-xs text-muted">{t('admin.adminLeagues.userSearchLoading')}</p>
        ) : (
          filteredUsers.length === 0 && (
            <p className="mt-2 text-xs text-muted">{t('admin.adminLeagues.userSearchEmpty')}</p>
          )
        )}
        {anyResultIsOrgLinked && (
          <p className="mt-2 text-xs text-muted">{t('admin.adminLeagues.ownersOrgLinkedNudge')}</p>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.adminLeagues.memberOrgsHeading')}
        </h2>
        <p className="mb-4 text-xs text-muted">{t('admin.adminLeagues.memberOrgsDescription')}</p>
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
