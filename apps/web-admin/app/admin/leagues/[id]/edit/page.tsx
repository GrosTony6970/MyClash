'use client';

import Link from 'next/link';
import { ScoringSystemPreview } from '../../../rulesets/league/_components/ScoringSystemPreview';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FFAMHE_POINTS, fuzzyMatch } from '../../league-utils';
import { LeagueRequestsPanel } from '../../../../../src/components/league/LeagueRequestsPanel';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { useConfirm, useToast } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';

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
  group_id?: string | null;
  tournaments?: {
    id?: string | null;
    name?: string | null;
    weapon?: string | null;
    status?: string | null;
    events?: { id?: string | null; name?: string | null } | null;
  } | null;
  league_groups?: { id: string; name: string } | null;
}

interface LeagueGroup {
  id: string;
  league_id: string;
  name: string;
  sort_order: number;
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
  status: string | null;
}

interface ScoringSystemOption {
  id: string;
  code: string;
  name: string;
  version: string;
  is_builtin: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
}

interface ScoringSystemVersionRow {
  id: string;
  league_scoring_system_id: string;
  version: string;
  name: string;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  published_at: string;
}

/**
 * Parse a stored scoring-system reference ('code' or 'code@version')
 * into its parts. Post-migration 0087 stored values are 'code@version';
 * the legacy code-only form remains supported.
 */
function parseScoringRef(stored: string | null | undefined): {
  code: string;
  version: string | null;
} {
  if (!stored) return { code: 'ffamhe_tf_2026', version: null };
  const at = stored.indexOf('@');
  if (at < 0) return { code: stored, version: null };
  const code = stored.slice(0, at);
  const version = stored.slice(at + 1);
  return { code, version: version.length > 0 ? version : null };
}

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export default function EditLeaguePage() {
  const { t, locale } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const leagueId = params.id;
  const [recomputing, setRecomputing] = useState(false);

  // Manual standings recompute — the endpoint existed with no UI, so drifted
  // standings could only be fixed by waiting for automatic triggers.
  async function recomputeRankings() {
    setRecomputing(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/recompute`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.adminLeagues.recomputeFailed'));
      toast.success(t('admin.adminLeagues.recomputeDone'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.adminLeagues.recomputeFailed'));
    } finally {
      setRecomputing(false);
    }
  }
  const searchParams = useSearchParams();
  const justCreated = searchParams.get('created') === '1';

  const [league, setLeague] = useState<League | null>(null);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [orgRoles, setOrgRoles] = useState<OrgRoleRow[]>([]);
  const [tournamentLinks, setTournamentLinks] = useState<TournamentLink[]>([]);
  const [groups, setGroups] = useState<LeagueGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [allUsers, setAllUsers] = useState<AdminUserOption[]>([]);
  const [allOrgs, setAllOrgs] = useState<OrgOption[]>([]);
  const [allEvents, setAllEvents] = useState<EventOption[]>([]);

  // Form state mirrors league
  const [name, setName] = useState('');
  const [seasonYear, setSeasonYear] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  // Role applied when attaching an org below. Admin/Owner surface the league in
  // the org's Manage tab; Member is participation-only (Membership tab).
  const [orgAddRole, setOrgAddRole] = useState<'member' | 'admin' | 'owner'>('member');
  const [rankingDimensions, setRankingDimensions] = useState<'weapon' | 'weapon_category'>(
    'weapon',
  );
  // The scoring system is a free-form code: 'ffamhe_tf_2026', 'custom', or
  // any preset code from the `league_scoring_systems` registry (migration
  // 0068). The literal 'custom' branch shows the inline rank→points grid.
  const [scoringSystem, setScoringSystem] = useState<string>('ffamhe_tf_2026');
  const [scoringSystemVersion, setScoringSystemVersion] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState<Record<number, number>>(FFAMHE_POINTS);
  const [scoringSystemOptions, setScoringSystemOptions] = useState<ScoringSystemOption[]>([]);
  const [versionsByCode, setVersionsByCode] = useState<Record<string, ScoringSystemVersionRow[]>>(
    {},
  );

  // Add forms
  const [userSearch, setUserSearch] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [tournamentsByEvent, setTournamentsByEvent] = useState<Record<string, TournamentOption[]>>(
    {},
  );
  // Per-row group choice for the unlinked-tournament Link affordance.
  // Operator picks a group from the inline select on each tournament
  // row; the Link click reads the choice for that row. Default is null
  // (sentinel "—") so the operator must be explicit when groups exist;
  // when no groups exist, the select is hidden and link goes through
  // with null.
  const [selectedGroupByTournament, setSelectedGroupByTournament] = useState<
    Record<string, string | null>
  >({});

  // UI state
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLeague = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' });
    if (!res.ok) throw new Error(t('admin.leagues.editPage.loadError'));
    const data = (await res.json()) as League[];
    const found = data.find((l) => l.id === leagueId);
    if (!found) throw new Error(t('admin.leagues.editPage.notFound'));
    setLeague(found);
    setName(found.name);
    setSeasonYear(String(found.season_year));
    setDescription(found.description ?? '');
    setStatus(found.status);
    setRankingDimensions(found.scoring_config?.rankingDimensions ?? 'weapon');
    const parsed = parseScoringRef(found.scoring_system);
    setScoringSystem(parsed.code);
    setScoringSystemVersion(parsed.version);
    if (found.scoring_config?.customPointsByRank) {
      setCustomPoints(found.scoring_config.customPointsByRank);
    }
  }, [leagueId, t]);

  const loadVersionsForSystem = useCallback(async (systemId: string, code: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${systemId}/versions`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as ScoringSystemVersionRow[];
      setVersionsByCode((prev) => ({ ...prev, [code]: rows }));
    } catch {
      // Silent — version dropdown just stays empty.
    }
  }, []);

  const loadScoringSystems = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const rows = (await res.json()) as ScoringSystemOption[];
    setScoringSystemOptions(rows);
  }, []);

  // Whenever the selected scoring-system code changes, load its version
  // history so the version dropdown can offer the available snapshots.
  // Cached per-code so switching back doesn't refetch.
  useEffect(() => {
    if (scoringSystem === 'custom') return;
    if (versionsByCode[scoringSystem]) return;
    const opt = scoringSystemOptions.find((o) => o.code === scoringSystem);
    if (!opt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch caches version snapshots on demand
    void loadVersionsForSystem(opt.id, scoringSystem);
  }, [scoringSystem, scoringSystemOptions, versionsByCode, loadVersionsForSystem]);

  const loadAssignments = useCallback(async () => {
    const [usersRes, orgsRes, linksRes, groupsRes] = await Promise.all([
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
        credentials: 'include',
      }),
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournament-links`, {
        credentials: 'include',
      }),
      fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/groups`, { credentials: 'include' }),
    ]);
    if (usersRes.ok) setUserRoles(((await usersRes.json()) as UserRoleRow[]) ?? []);
    if (orgsRes.ok) setOrgRoles(((await orgsRes.json()) as OrgRoleRow[]) ?? []);
    if (linksRes.ok) {
      const data = (await linksRes.json()) as TournamentLink[];
      setTournamentLinks(data.filter((l) => l.status !== 'removed'));
    }
    if (groupsRes.ok) setGroups(((await groupsRes.json()) as LeagueGroup[]) ?? []);
  }, [leagueId]);

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sortOrder: groups.length }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.leagues.editPage.groups.createError'));
      }
      setNewGroupName('');
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.groups.createError'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!(await confirm({ title: t('admin.leagues.editPage.groups.deleteConfirm'), danger: true })))
      return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/admin/league-groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await loadAssignments();
    } finally {
      setBusy(false);
    }
  }

  async function reassignLinkGroup(linkId: string, groupId: string | null) {
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });
      await loadAssignments();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load populates form state from the API
    void loadLeague().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.loadError'));
    });
    void loadAssignments().catch(() => undefined);
    void loadScoringSystems().catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/users?perPage=200`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users: AdminUserOption[] }) => setAllUsers(data.users ?? []))
      .catch(() => undefined);
    void fetch(`${apiUrl}/api/v1/admin/organizations?excludePlatform=true`, {
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(t('admin.leagues.editPage.orgsLoadError'));
        return (await r.json()) as OrgOption[] | { organizations: OrgOption[] };
      })
      .then((data) => setAllOrgs(Array.isArray(data) ? data : (data.organizations ?? [])))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.leagues.editPage.orgsLoadError'));
      });
    void fetch(`${apiUrl}/api/v1/events?status=all`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: EventOption[]) => setAllEvents(data ?? []))
      .catch(() => undefined);
  }, [loadLeague, loadAssignments, loadScoringSystems, t]);

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
    // Belt-and-braces: server query already passes `excludePlatform=true`, but
    // legacy rows where `is_platform` was never flagged still slip through.
    // Drop the well-known platform slug `myclash-hq` here so the picker is
    // always clean — the server's addOrganizationRole guard also refuses it.
    return allOrgs.filter((o) => !taken.has(o.id) && o.slug !== 'myclash-hq');
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
      // Encode the scoring-system reference as 'code@version' when a
      // version is pinned. Migration 0087 made this the canonical format
      // so leagues stay frozen at the version they explicitly selected
      // even if a super-admin edits the source scoring system.
      const scoringSystemRef =
        scoringSystem === 'custom'
          ? 'custom'
          : scoringSystemVersion
            ? `${scoringSystem}@${scoringSystemVersion}`
            : scoringSystem;
      const scoringConfig: Record<string, unknown> = {
        scoringSystem: scoringSystemRef,
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
          // Visibility is derived from status: Published ⇒ publicly visible.
          publicVisibility: status === 'published',
          scoringConfig,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.leagues.editPage.basics.saveError'));
      }
      flashSaved(t('admin.leagues.editPage.savedFlash'));
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.basics.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError(t('admin.leagues.editPage.logo.wrongTypeError'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('admin.leagues.editPage.logo.tooLargeError'));
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
        throw new Error(body.message ?? t('admin.leagues.editPage.logo.uploadError'));
      }
      flashSaved(t('admin.leagues.editPage.logo.uploadFlash'));
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.logo.uploadError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!(await confirm({ title: t('admin.leagues.editPage.logo.removeConfirm'), danger: true })))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/logo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.leagues.editPage.logo.removeError'));
      flashSaved(t('admin.leagues.editPage.logo.removeFlash'));
      await loadLeague();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.logo.removeError'));
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
        throw new Error(body.message ?? t('admin.leagues.editPage.owners.addError'));
      }
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.owners.addError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeOwner(userIdSel: string) {
    if (!(await confirm({ title: t('admin.leagues.editPage.owners.detachConfirm'), danger: true })))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles/${userIdSel}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('admin.leagues.editPage.owners.detachError'));
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.owners.detachError'));
    } finally {
      setBusy(false);
    }
  }

  async function addOrg(orgId: string, role: 'member' | 'admin' | 'owner') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.leagues.editPage.orgs.addError'));
      }
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.orgs.addError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeOrg(orgId: string) {
    if (!(await confirm({ title: t('admin.leagues.editPage.orgs.detachConfirm'), danger: true })))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles/${orgId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('admin.leagues.editPage.orgs.detachError'));
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.leagues.editPage.orgs.detachError'));
    } finally {
      setBusy(false);
    }
  }

  async function addTournamentLink(tournamentId: string, groupId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/link`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.leagues.editPage.tournaments.addError'));
      }
      await loadAssignments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.leagues.editPage.tournaments.addError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeTournamentLink(linkId: string) {
    if (
      !(await confirm({
        title: t('admin.leagues.editPage.tournaments.detachConfirm'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/league-tournament-links/${linkId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'removed' }),
      });
      if (!res.ok) throw new Error(t('admin.leagues.editPage.tournaments.detachError'));
      await loadAssignments();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.leagues.editPage.tournaments.detachError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!league) {
    return (
      <main className="p-8">
        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('admin.leagues.editPage.loadingState')}</p>
        )}
      </main>
    );
  }

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-2 text-sm">
        <Link href="/admin/leagues" className="text-muted hover:underline">
          {t('admin.leagues.editPage.backLink')}
        </Link>
      </div>
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-6">
        {t('admin.leagues.editPage.pageTitle')}
      </h1>

      {justCreated && (
        <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          {t('admin.leagues.editPage.createdBanner')}
        </div>
      )}
      {savedFlash && (
        <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          {savedFlash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Basics */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.basics.heading')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.leagues.editPage.basics.nameLabel')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.leagues.editPage.basics.yearLabel')}
            <input
              value={seasonYear}
              readOnly
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-medium text-foreground-secondary sm:col-span-2">
            {t('admin.leagues.editPage.basics.slugLabel')}
            <input
              value={league.slug}
              readOnly
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.leagues.editPage.basics.categoryLabel')}
            <select
              value={rankingDimensions}
              onChange={(e) => setRankingDimensions(e.target.value as 'weapon' | 'weapon_category')}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="weapon">{t('admin.leagues.editPage.basics.categoryWeapon')}</option>
              <option value="weapon_category">
                {t('admin.leagues.editPage.basics.categoryWeaponPlusCategory')}
              </option>
            </select>
          </label>
          <label className="text-xs font-medium text-foreground-secondary">
            {t('admin.leagues.editPage.basics.scoringSystemLabel')}
            <select
              value={scoringSystem}
              onChange={(e) => {
                const nextCode = e.target.value;
                setScoringSystem(nextCode);
                // Reset version to the latest known version of the new code
                // so the league pins to the freshly-published values by
                // default. The user can switch to an older version via the
                // version dropdown if they want immutability against
                // future edits.
                const opt = scoringSystemOptions.find((o) => o.code === nextCode);
                setScoringSystemVersion(opt?.version ?? null);
                if (opt && !versionsByCode[nextCode]) {
                  void loadVersionsForSystem(opt.id, nextCode);
                }
              }}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              {scoringSystemOptions.length === 0 && (
                <option value="ffamhe_tf_2026">{t('admin.adminLeagues.ffamheTf2026Option')}</option>
              )}
              {scoringSystemOptions.map((opt) => (
                <option key={opt.id} value={opt.code}>
                  {opt.name}
                  {opt.is_builtin ? t('admin.leagues.editPage.basics.builtinSuffix') : ''}
                </option>
              ))}
              <option value="custom">{t('admin.leagues.editPage.basics.customOption')}</option>
            </select>
            <Link
              href="/admin/rulesets/league"
              className="mt-1 inline-block text-[11px] font-medium text-accent hover:underline"
            >
              {t('admin.leagues.editPage.basics.manageScoringSystemsLink')}
            </Link>
          </label>
          {scoringSystem !== 'custom' && (
            <label className="text-xs font-medium text-foreground-secondary">
              {t('admin.leagues.editPage.basics.versionLabel')}
              <select
                value={scoringSystemVersion ?? ''}
                onChange={(e) => setScoringSystemVersion(e.target.value || null)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="">{t('admin.leagues.editPage.basics.versionLatestOption')}</option>
                {(versionsByCode[scoringSystem] ?? []).map((v) => (
                  <option key={v.id} value={v.version}>
                    {t('admin.adminLeagues.versionOption', {
                      version: v.version,
                      date: new Date(v.published_at).toLocaleDateString(localeToBcp47(locale)),
                    })}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-muted">
                {t('admin.leagues.editPage.basics.versionHelp')}
              </span>
            </label>
          )}
          {/* Publishing control. A single Status dropdown drives everything:
              Published ⇒ the league is publicly visible on app.myclash.fr.
              The BE AND-gate (leagues.service.ts:45-56) still requires
              public_visibility = true AND status = 'published'; we derive
              public_visibility from status on save so the two stay in lockstep. */}
          <fieldset className="sm:col-span-2 rounded-lg border border-border bg-background p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
              {t('admin.leagues.editPage.basics.publishingLegend')}
            </legend>
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                {t('admin.leagues.editPage.basics.statusLabel')}
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="draft">{t('admin.leagues.editPage.basics.statusDraft')}</option>
                <option value="published">
                  {t('admin.leagues.editPage.basics.statusPublished')}
                </option>
                <option value="archived">
                  {t('admin.leagues.editPage.basics.statusArchived')}
                </option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                {t('admin.leagues.editPage.basics.statusHelp')}
              </span>
            </label>
          </fieldset>
          <label className="text-xs font-medium text-foreground-secondary sm:col-span-2">
            {t('admin.leagues.editPage.basics.descriptionLabel')}
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>

        {scoringSystem !== 'custom' &&
          (() => {
            // Resolve which snapshot to show: pinned version → that version's
            // values; latest → the current registry row's values.
            const opt = scoringSystemOptions.find((o) => o.code === scoringSystem);
            if (!opt) return null;
            const snapshot = scoringSystemVersion
              ? (versionsByCode[scoringSystem] ?? []).find(
                  (v) => v.version === scoringSystemVersion,
                )
              : undefined;
            const data = snapshot ?? {
              version: opt.version,
              name: opt.name,
              description: opt.description,
              points_by_rank: opt.points_by_rank,
              tie_breakers: opt.tie_breakers,
            };
            return (
              <details className="mt-4" open>
                <summary className="cursor-pointer text-xs font-medium text-foreground-secondary hover:text-foreground">
                  {t('admin.leagues.editPage.basics.previewSummary')}
                </summary>
                <div className="mt-2">
                  <ScoringSystemPreview
                    name={data.name}
                    code={opt.code}
                    version={data.version}
                    description={data.description}
                    pointsByRank={data.points_by_rank}
                    tieBreakers={data.tie_breakers}
                  />
                </div>
              </details>
            );
          })()}

        {scoringSystem === 'custom' && (
          <div className="mt-4">
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {t('admin.leagues.editPage.basics.pointsByRankLabel')}
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {Object.entries(customPoints).map(([rank, points]) => (
                <label key={rank} className="text-[11px] text-muted">
                  {t('admin.leagues.editPage.basics.rankLabel', { rank })}
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

        <button
          type="button"
          onClick={() => void saveBasics()}
          disabled={busy}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {t('admin.leagues.editPage.basics.saveButton')}
        </button>
      </section>

      {/* Logo */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.logo.heading')}
        </h2>
        <div className="flex items-center gap-4">
          {league.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={league.logo_url}
              alt={league.name}
              className="h-24 w-24 rounded-md border border-border bg-surface object-contain"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-border bg-background text-lg font-bold text-muted">
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
              className="block w-full rounded-md border border-border px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground-secondary hover:file:bg-background"
            />
            <p className="mt-1 text-[11px] text-muted">
              {t('admin.leagues.editPage.logo.helperText')}
            </p>
            {league.logo_url && (
              <button
                type="button"
                onClick={() => void removeLogo()}
                disabled={busy}
                className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                {t('admin.leagues.editPage.logo.removeButton')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Owner accounts */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.owners.heading')}
        </h2>
        <p className="mb-4 text-xs text-muted">{t('admin.leagues.editPage.owners.description')}</p>
        {userRoles.length === 0 ? (
          <p className="text-sm text-muted italic">{t('admin.leagues.editPage.owners.empty')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {userRoles.map((r) => (
              <li key={r.userId} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">
                    {r.displayName || t('admin.leagues.editPage.owners.nameFallback')}
                    <span className="ml-2 text-xs font-normal text-muted">{r.role}</span>
                  </p>
                  <p className="text-xs text-muted">{r.email}</p>
                  {r.organizations.length > 0 && (
                    <div
                      className="mt-1 flex flex-wrap items-center gap-1"
                      title={t('admin.leagues.editPage.owners.orgMembershipsHint')}
                    >
                      <span className="text-[10px] uppercase tracking-wide text-muted">
                        {t('admin.leagues.editPage.owners.orgMembershipsLabel')}
                      </span>
                      {r.organizations.slice(0, 3).map((o) => (
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
                <button
                  type="button"
                  onClick={() => void removeOwner(r.userId)}
                  disabled={busy}
                  className="rounded-md border border-danger/30 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('admin.leagues.editPage.owners.detachButton')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border pt-4">
          <input
            type="search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder={t('admin.leagues.editPage.owners.searchPlaceholder')}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
          {filteredUsers.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void addOwner(u.id)}
                  disabled={busy}
                  className="block w-full text-left border-b border-border px-3 py-2 text-sm hover:bg-info/10 disabled:opacity-50 last:border-0"
                >
                  <span className="font-medium">
                    {u.display_name || t('admin.leagues.editPage.owners.nameFallback')}
                  </span>
                  <span className="ml-2 text-xs text-muted">{u.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Orgs */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.orgs.heading')}
        </h2>
        {orgRoles.length === 0 ? (
          <p className="text-sm text-muted italic">{t('admin.leagues.editPage.orgs.empty')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {orgRoles.map((r) => (
              <li
                key={r.organizationId}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{r.name}</p>
                  <p className="font-mono text-xs text-muted">{r.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{r.role}</span>
                  <button
                    type="button"
                    onClick={() => void removeOrg(r.organizationId)}
                    disabled={busy}
                    className="rounded-md border border-danger/30 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t('admin.leagues.editPage.orgs.detachButton')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {availableOrgs.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-foreground-secondary mb-2">
              {t('admin.leagues.editPage.orgs.addHeading')}
            </p>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-foreground">
                {t('admin.leagues.editPage.orgs.roleLabel')}
              </span>
              <select
                value={orgAddRole}
                onChange={(e) => setOrgAddRole(e.target.value as 'member' | 'admin' | 'owner')}
                className="w-full rounded-md border border-border px-3 py-2 text-sm sm:w-auto"
              >
                <option value="member">{t('admin.leagues.editPage.orgs.roleMember')}</option>
                <option value="admin">{t('admin.leagues.editPage.orgs.roleAdmin')}</option>
                <option value="owner">{t('admin.leagues.editPage.orgs.roleOwner')}</option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                {t('admin.leagues.editPage.orgs.roleHint')}
              </span>
            </label>
            <div className="grid gap-1 sm:grid-cols-2 max-h-40 overflow-y-auto">
              {availableOrgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => void addOrg(o.id, orgAddRole)}
                  disabled={busy}
                  className="rounded border border-border px-3 py-1.5 text-left text-sm hover:bg-info/10 disabled:opacity-50"
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Groups */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.groups.heading')}
        </h2>
        <p className="mb-3 text-xs text-muted">{t('admin.leagues.editPage.groups.description')}</p>
        {groups.length === 0 ? (
          <p className="mb-3 text-sm italic text-muted">
            {t('admin.leagues.editPage.groups.empty')}
          </p>
        ) : (
          <ul className="mb-3 divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-foreground">{g.name}</span>
                <button
                  type="button"
                  onClick={() => void deleteGroup(g.id)}
                  disabled={busy}
                  className="rounded-md border border-danger/30 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('admin.leagues.editPage.groups.deleteButton')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t('admin.leagues.editPage.groups.newNamePlaceholder')}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void createGroup()}
            disabled={busy || !newGroupName.trim()}
            className="rounded-md bg-strong px-3 py-1.5 text-xs font-semibold text-strong-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t('admin.leagues.editPage.groups.addButton')}
          </button>
        </div>
      </section>

      {/* Tournaments */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.leagues.editPage.tournaments.heading')}
        </h2>
        {tournamentLinks.length === 0 ? (
          <p className="text-sm text-muted italic">
            {t('admin.leagues.editPage.tournaments.empty')}
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {tournamentLinks.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {link.tournaments?.name ?? t('admin.leagues.editPage.tournaments.nameFallback')}
                  </p>
                  <p className="text-xs text-muted">
                    {link.tournaments?.events?.name ?? ''}{' '}
                    {link.tournaments?.weapon && (
                      <span className="text-muted">· {link.tournaments.weapon}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {groups.length > 0 && (
                    <select
                      value={link.group_id ?? ''}
                      onChange={(e) => void reassignLinkGroup(link.id, e.target.value || null)}
                      disabled={busy}
                      className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs"
                    >
                      <option value="">
                        {t('admin.leagues.editPage.tournaments.noGroupOption')}
                      </option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground-secondary">
                    {link.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeTournamentLink(link.id)}
                    disabled={busy}
                    className="rounded-md border border-danger/30 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t('admin.leagues.editPage.tournaments.detachButton')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-foreground-secondary mb-2">
            {t('admin.leagues.editPage.tournaments.addHeading')}
          </p>
          <input
            type="search"
            value={eventQuery}
            onChange={(e) => setEventQuery(e.target.value)}
            placeholder={t('admin.leagues.editPage.tournaments.eventSearchPlaceholder')}
            className="w-full rounded-md border border-border px-3 py-2 text-sm"
          />
          {filteredEvents.length > 0 && (
            <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border">
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
                          {t('admin.leagues.editPage.tournaments.noTournaments')}
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {(tournamentsByEvent[ev.id] ?? []).map((tour) => {
                            const already = tournamentLinks.some(
                              (l) => l.tournaments?.id === tour.id,
                            );
                            return (
                              <li
                                key={tour.id}
                                className="flex items-center justify-between gap-2 text-xs"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span>
                                    {tour.name ??
                                      t('admin.leagues.editPage.tournaments.nameFallback')}
                                  </span>
                                  {tour.weapon && (
                                    <span className="text-muted">· {tour.weapon}</span>
                                  )}
                                  {tour.status && (
                                    <span
                                      className={[
                                        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                        tour.status === 'published'
                                          ? 'bg-success/10 text-success'
                                          : tour.status === 'draft'
                                            ? 'bg-warning/10 text-warning'
                                            : tour.status === 'completed'
                                              ? 'bg-background text-foreground-secondary'
                                              : 'bg-background text-muted',
                                      ].join(' ')}
                                    >
                                      {tour.status}
                                    </span>
                                  )}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {!already && groups.length > 0 && (
                                    <select
                                      value={selectedGroupByTournament[tour.id] ?? ''}
                                      onChange={(e) =>
                                        setSelectedGroupByTournament((prev) => ({
                                          ...prev,
                                          [tour.id]: e.target.value || null,
                                        }))
                                      }
                                      disabled={busy}
                                      className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                                    >
                                      <option value="">
                                        {t('admin.leagues.editPage.tournaments.noGroupOption')}
                                      </option>
                                      {groups.map((g) => (
                                        <option key={g.id} value={g.id}>
                                          {g.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <button
                                    type="button"
                                    disabled={already || busy}
                                    onClick={() =>
                                      void addTournamentLink(
                                        tour.id,
                                        selectedGroupByTournament[tour.id] ?? null,
                                      )
                                    }
                                    className={[
                                      'rounded px-2 py-0.5 font-semibold',
                                      already
                                        ? 'bg-background text-muted'
                                        : 'bg-info/10 text-info hover:bg-info/20',
                                    ].join(' ')}
                                  >
                                    {already
                                      ? t('admin.leagues.editPage.tournaments.linkedButton')
                                      : t('admin.leagues.editPage.tournaments.addButton')}
                                  </button>
                                </div>
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

      {/* Pending requests (tournament-attach + org-join) */}
      <section className="mb-6">
        <LeagueRequestsPanel leagueId={leagueId} />
      </section>

      {/* Exports + maintenance — surfaces the final-report and recompute
          endpoints that previously had no UI anywhere. */}
      <section className="mb-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display font-semibold text-lg text-foreground">
          {t('admin.adminLeagues.exportsTitle')}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={`${apiUrl}/api/v1/leagues/${leagueId}/final-report.csv`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground"
          >
            {t('admin.adminLeagues.downloadReportCsv')}
          </a>
          <a
            href={`${apiUrl}/api/v1/leagues/${leagueId}/final-report.print.html`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground"
          >
            {t('admin.adminLeagues.printableReport')}
          </a>
          <button
            type="button"
            onClick={() => void recomputeRankings()}
            disabled={recomputing}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            {recomputing
              ? t('admin.adminLeagues.recomputing')
              : t('admin.adminLeagues.recomputeButton')}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{t('admin.adminLeagues.recomputeHint')}</p>
      </section>
      {confirmDialog}
    </main>
  );
}
