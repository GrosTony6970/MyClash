'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentedTabs, useConfirm, useToast } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '../../i18n/I18nProvider';
import { LeagueRequestsPanel } from './LeagueRequestsPanel';
import { ScoringSystemPreview } from './ScoringSystemPreview';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

type SectionTab = 'basics' | 'ruleset' | 'groups' | 'tournaments' | 'requests' | 'roles';

export interface LeagueManageViewProps {
  leagueId: string;
  /** Where the "back to list" links point — the caller owns its own route tree. */
  backHref: string;
  /**
   * Which workspace is rendering this. A serializable discriminator, NOT an
   * injected loader: the loader would sit in an effect dependency array, so an
   * unmemoized parent function would re-fire the fetch on every render.
   */
  source: { kind: 'org'; slug: string } | { kind: 'personal' };
}

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
    rankingDimensions?: 'weapon' | 'weapon_category';
    customPointsByRank?: Record<number, number>;
    tieBreakers?: string[];
  } | null;
}

interface LeagueGroup {
  id: string;
  league_id: string;
  name: string;
  sort_order: number;
}

interface TournamentLink {
  id: string;
  status: 'requested' | 'approved' | 'rejected' | 'removed';
  group_id?: string | null;
  tournaments?: {
    id?: string | null;
    name?: string | null;
    weapon?: string | null;
    events?: { id?: string | null; name?: string | null } | null;
  } | null;
  league_groups?: { id: string; name: string } | null;
}

interface UserRoleRow {
  userId: string;
  role: string;
  displayName: string | null;
  email: string | null;
}

interface OrgRoleRow {
  organizationId: string;
  role: string;
  name: string;
  slug: string;
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

/** Parse a stored scoring-system reference ('code' or 'code@version'). */
function parseScoringRef(stored: string | null | undefined): {
  code: string;
  version: string | null;
} {
  if (!stored) return { code: 'ffamhe_tf_2026', version: null };
  const at = stored.indexOf('@');
  if (at < 0) return { code: stored, version: null };
  return { code: stored.slice(0, at), version: stored.slice(at + 1) || null };
}

export function LeagueManageView({ leagueId, backHref, source }: LeagueManageViewProps) {
  const { t, locale } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
  // Kept primitive so every useCallback dependency below stays primitive.
  const orgSlug = source.kind === 'org' ? source.slug : null;

  const [tab, setTab] = useState<SectionTab>('basics');
  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Basics form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');

  // Ruleset form state
  const [rankingDimensions, setRankingDimensions] = useState<'weapon' | 'weapon_category'>(
    'weapon',
  );
  const [scoringSystem, setScoringSystem] = useState('ffamhe_tf_2026');
  const [scoringSystemVersion, setScoringSystemVersion] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState<Record<number, number>>({});
  const [scoringSystemOptions, setScoringSystemOptions] = useState<ScoringSystemOption[]>([]);
  const [versionsByCode, setVersionsByCode] = useState<Record<string, ScoringSystemVersionRow[]>>(
    {},
  );

  // Groups / tournaments / roles
  const [groups, setGroups] = useState<LeagueGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [tournamentLinks, setTournamentLinks] = useState<TournamentLink[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([]);
  const [orgRoles, setOrgRoles] = useState<OrgRoleRow[]>([]);

  const applyLeague = useCallback((found: League) => {
    setLeague(found);
    setName(found.name);
    setDescription(found.description ?? '');
    setStatus(found.status);
    setRankingDimensions(found.scoring_config?.rankingDimensions ?? 'weapon');
    const parsed = parseScoringRef(found.scoring_system);
    setScoringSystem(parsed.code);
    setScoringSystemVersion(parsed.version);
    if (found.scoring_config?.customPointsByRank) {
      setCustomPoints(found.scoring_config.customPointsByRank);
    }
  }, []);

  const loadLeague = useCallback(async () => {
    if (orgSlug === null) {
      // Personal workspace: one O(1) read, authorized per-league by
      // assertCanManageLeague. There is no org to scope to.
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('organizer.leagues.manage.notFound'));
      applyLeague((await res.json()) as League);
      return;
    }

    // Resolve org → id, then load the org's managed leagues and find this one.
    // This both scopes the page to the org and confirms manage rights (the
    // endpoint asserts org admin/owner). Kept even though a single-league
    // endpoint now exists: collapsing both routes onto it would let someone
    // with a direct grant open /org/{unrelated-slug}/leagues/{id} — no
    // escalation, since every mutation still asserts, but the URL would lie.
    const orgRes = await fetch(
      `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(orgSlug)}`,
      {
        credentials: 'include',
      },
    );
    if (!orgRes.ok) throw new Error(t('organizer.leagues.manage.loadError'));
    const orgData = (await orgRes.json()) as { id: string };
    const res = await fetch(`${apiUrl}/api/v1/organizations/${orgData.id}/leagues`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(t('organizer.leagues.manage.loadError'));
    const rows = (await res.json()) as League[];
    const found = rows.find((l) => l.id === leagueId);
    if (!found) throw new Error(t('organizer.leagues.manage.notFound'));
    applyLeague(found);
  }, [orgSlug, leagueId, t, applyLeague]);

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

  const loadScoringSystems = useCallback(async () => {
    const res = await fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    setScoringSystemOptions((await res.json()) as ScoringSystemOption[]);
  }, []);

  const loadVersionsForSystem = useCallback(async (systemId: string, code: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${systemId}/versions`,
        {
          credentials: 'include',
        },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as ScoringSystemVersionRow[];
      setVersionsByCode((prev) => ({ ...prev, [code]: rows }));
    } catch {
      // Silent — version dropdown just stays empty.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadLeague();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('organizer.leagues.manage.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs in promise callbacks, not synchronously
    void loadAssignments().catch(() => undefined);
    void loadScoringSystems().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadLeague, loadAssignments, loadScoringSystems, t]);

  useEffect(() => {
    if (scoringSystem === 'custom') return;
    if (versionsByCode[scoringSystem]) return;
    const opt = scoringSystemOptions.find((o) => o.code === scoringSystem);
    if (!opt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch caches version snapshots on demand
    void loadVersionsForSystem(opt.id, scoringSystem);
  }, [scoringSystem, scoringSystemOptions, versionsByCode, loadVersionsForSystem]);

  // ── Preview data for the selected ruleset ────────────────────────────────
  const previewData = useMemo(() => {
    if (scoringSystem === 'custom') {
      const pts: Record<string, number> = {};
      for (const [k, v] of Object.entries(customPoints)) pts[k] = v;
      return {
        pointsByRank: pts,
        tieBreakers: [] as string[],
        name: undefined,
        version: undefined,
      };
    }
    const versionRow = (versionsByCode[scoringSystem] ?? []).find(
      (v) => v.version === scoringSystemVersion,
    );
    if (versionRow) {
      return {
        pointsByRank: versionRow.points_by_rank,
        tieBreakers: versionRow.tie_breakers,
        name: versionRow.name,
        version: versionRow.version,
      };
    }
    const opt = scoringSystemOptions.find((o) => o.code === scoringSystem);
    return {
      pointsByRank: opt?.points_by_rank ?? {},
      tieBreakers: opt?.tie_breakers ?? [],
      name: opt?.name,
      version: opt?.version,
    };
  }, [scoringSystem, scoringSystemVersion, versionsByCode, scoringSystemOptions, customPoints]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function patchLeague(body: Record<string, unknown>, successKey: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? t('organizer.leagues.manage.saveError'));
      }
      toast.success(t(successKey));
      await loadLeague();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('organizer.leagues.manage.saveError');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function saveBasics() {
    return patchLeague(
      {
        name: name.trim(),
        description: description.trim() || null,
        status,
      },
      'organizer.leagues.manage.savedToast',
    );
  }

  function saveRuleset() {
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
    if (scoringSystem === 'custom') scoringConfig['customPointsByRank'] = customPoints;
    return patchLeague({ scoringConfig }, 'organizer.leagues.manage.savedToast');
  }

  async function createGroup() {
    const groupName = newGroupName.trim();
    if (!groupName) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName, sortOrder: groups.length }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? t('organizer.leagues.manage.groups.createError'));
      }
      setNewGroupName('');
      await loadAssignments();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('organizer.leagues.manage.groups.createError');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(groupId: string) {
    if (
      !(await confirm({ title: t('organizer.leagues.manage.groups.deleteConfirm'), danger: true }))
    )
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

  async function detachTournament(linkId: string) {
    if (
      !(await confirm({
        title: t('organizer.leagues.manage.tournaments.detachConfirm'),
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
      if (!res.ok) throw new Error(t('organizer.leagues.manage.tournaments.detachError'));
      toast.success(t('organizer.leagues.manage.tournaments.detachedToast'));
      await loadAssignments();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('organizer.leagues.manage.tournaments.detachError');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function changeOrgRole(organizationId: string, role: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, role }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? t('organizer.leagues.manage.roles.updateError'));
      }
      toast.success(t('organizer.leagues.manage.savedToast'));
      await loadAssignments();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('organizer.leagues.manage.roles.updateError');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removeOrgRole(organizationId: string) {
    if (
      !(await confirm({
        title: t('organizer.leagues.manage.roles.removeOrgConfirm'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await fetch(
        `${apiUrl}/api/v1/admin/leagues/${leagueId}/organization-roles/${organizationId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      );
      await loadAssignments();
    } finally {
      setBusy(false);
    }
  }

  async function removeUserRole(userId: string) {
    if (
      !(await confirm({
        title: t('organizer.leagues.manage.roles.removeUserConfirm'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/user-roles/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await loadAssignments();
    } finally {
      setBusy(false);
    }
  }

  const tabs = useMemo(
    () => [
      { value: 'basics' as const, label: t('organizer.leagues.manage.tabBasics') },
      { value: 'ruleset' as const, label: t('organizer.leagues.manage.tabRuleset') },
      { value: 'groups' as const, label: t('organizer.leagues.manage.tabGroups') },
      { value: 'tournaments' as const, label: t('organizer.leagues.manage.tabTournaments') },
      { value: 'requests' as const, label: t('organizer.leagues.manage.tabRequests') },
      { value: 'roles' as const, label: t('organizer.leagues.manage.tabRoles') },
    ],
    [t],
  );

  if (loading && !league) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
        <p className="text-sm text-muted">{t('organizer.leagues.manage.loadingState')}</p>
      </main>
    );
  }

  if (!league) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
        <Link href={backHref} className="text-sm text-muted hover:underline">
          {t('organizer.leagues.manage.backToList')}
        </Link>
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error ?? t('organizer.leagues.manage.notFound')}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      {confirmDialog}
      <div className="mb-2 text-sm">
        <Link href={backHref} className="text-muted hover:underline">
          {t('organizer.leagues.manage.backToList')}
        </Link>
      </div>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.leagues.manage.eyebrow')}
        </p>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {league.name}
        </h1>
        <p className="mt-1 font-mono text-xs text-muted">
          /{league.slug} · {league.season_year}
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <SegmentedTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        aria-label={t('organizer.leagues.manage.eyebrow')}
        className="mb-6 max-w-3xl"
      />

      {tab === 'basics' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                {t('organizer.leagues.manage.basics.nameLabel')}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                {t('organizer.leagues.manage.basics.statusLabel')}
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="draft">{t('admin.adminLeagues.statusDraft')}</option>
                <option value="published">{t('admin.adminLeagues.statusPublished')}</option>
                <option value="archived">{t('admin.adminLeagues.statusArchived')}</option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                {t('organizer.leagues.manage.basics.statusHelp')}
              </span>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-foreground">
              {t('organizer.leagues.manage.basics.descriptionLabel')}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveBasics()}
            disabled={busy}
            className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {t('organizer.leagues.manage.saveButton')}
          </button>
        </section>
      )}

      {tab === 'ruleset' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                {t('organizer.leagues.manage.ruleset.scoringSystemLabel')}
              </span>
              <select
                value={scoringSystem}
                onChange={(e) => {
                  const nextCode = e.target.value;
                  setScoringSystem(nextCode);
                  const opt = scoringSystemOptions.find((o) => o.code === nextCode);
                  setScoringSystemVersion(opt?.version ?? null);
                }}
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                {scoringSystemOptions.map((opt) => (
                  <option key={opt.id} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
                <option value="custom">{t('organizer.leagues.manage.ruleset.customOption')}</option>
              </select>
            </label>
            {scoringSystem !== 'custom' && (
              <label className="block">
                <span className="text-sm font-medium text-foreground">
                  {t('organizer.leagues.manage.ruleset.versionLabel')}
                </span>
                <select
                  value={scoringSystemVersion ?? ''}
                  onChange={(e) => setScoringSystemVersion(e.target.value || null)}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="">{t('organizer.leagues.manage.ruleset.versionLatest')}</option>
                  {(versionsByCode[scoringSystem] ?? []).map((v) => (
                    <option key={v.id} value={v.version}>
                      {t('admin.adminLeagues.versionOption', {
                        version: v.version,
                        date: new Date(v.published_at).toLocaleDateString(localeToBcp47(locale)),
                      })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-sm font-medium text-foreground">
                {t('organizer.leagues.manage.ruleset.rankingDimsLabel')}
              </span>
              <select
                value={rankingDimensions}
                onChange={(e) =>
                  setRankingDimensions(e.target.value as 'weapon' | 'weapon_category')
                }
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                <option value="weapon">{t('organizer.leagues.manage.ruleset.dimWeapon')}</option>
                <option value="weapon_category">
                  {t('organizer.leagues.manage.ruleset.dimWeaponCategory')}
                </option>
              </select>
            </label>
          </div>

          {scoringSystem === 'custom' && (
            <p className="mt-4 rounded-md border border-border bg-background px-4 py-3 text-xs text-muted">
              {t('organizer.leagues.manage.ruleset.customNote')}
            </p>
          )}

          <div className="mt-4">
            <ScoringSystemPreview
              name={previewData.name}
              code={scoringSystem === 'custom' ? undefined : scoringSystem}
              version={previewData.version}
              pointsByRank={previewData.pointsByRank}
              tieBreakers={previewData.tieBreakers}
            />
          </div>

          <button
            type="button"
            onClick={() => void saveRuleset()}
            disabled={busy}
            className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {t('organizer.leagues.manage.saveButton')}
          </button>
        </section>
      )}

      {tab === 'groups' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          {groups.length === 0 && (
            <p className="mb-3 text-sm text-muted">{t('organizer.leagues.manage.groups.empty')}</p>
          )}
          <ul className="mb-4 divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-foreground">{g.name}</span>
                <button
                  type="button"
                  onClick={() => void deleteGroup(g.id)}
                  disabled={busy}
                  className="rounded-md border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('organizer.leagues.manage.groups.deleteButton')}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder={t('organizer.leagues.manage.groups.namePlaceholder')}
              className="w-64 rounded-md border border-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void createGroup()}
              disabled={busy || !newGroupName.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {t('organizer.leagues.manage.groups.addButton')}
            </button>
          </div>
        </section>
      )}

      {tab === 'tournaments' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          {tournamentLinks.length === 0 && (
            <p className="text-sm text-muted">{t('organizer.leagues.manage.tournaments.empty')}</p>
          )}
          <ul className="divide-y divide-border">
            {tournamentLinks.map((link) => (
              <li key={link.id} className="flex items-center justify-between py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {link.tournaments?.name ?? link.tournaments?.id ?? link.id}
                  </p>
                  <p className="text-xs text-muted">
                    {link.tournaments?.events?.name ?? ''}
                    {link.league_groups?.name ? ` · ${link.league_groups.name}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void detachTournament(link.id)}
                  disabled={busy}
                  className="rounded-md border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('organizer.leagues.manage.tournaments.detachButton')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'requests' && <LeagueRequestsPanel leagueId={leagueId} />}

      {tab === 'roles' && (
        <section className="space-y-6">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.leagues.manage.roles.orgsHeading')}
            </h2>
            {orgRoles.length === 0 && (
              <p className="text-sm text-muted">{t('organizer.leagues.manage.roles.noOrgs')}</p>
            )}
            <ul className="divide-y divide-border">
              {orgRoles.map((r) => (
                <li
                  key={r.organizationId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium text-foreground">{r.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={r.role}
                      onChange={(e) => void changeOrgRole(r.organizationId, e.target.value)}
                      disabled={busy}
                      className="rounded-md border border-border px-2 py-1 text-xs"
                    >
                      <option value="member">
                        {t('organizer.leagues.manage.roles.roleMember')}
                      </option>
                      <option value="admin">{t('organizer.leagues.manage.roles.roleAdmin')}</option>
                      <option value="owner">{t('organizer.leagues.manage.roles.roleOwner')}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeOrgRole(r.organizationId)}
                      disabled={busy}
                      className="rounded-md border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      {t('organizer.leagues.manage.roles.removeButton')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.leagues.manage.roles.ownersHeading')}
            </h2>
            {userRoles.length === 0 && (
              <p className="text-sm text-muted">{t('organizer.leagues.manage.roles.noUsers')}</p>
            )}
            <ul className="divide-y divide-border">
              {userRoles.map((r) => (
                <li key={r.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.displayName ?? r.email ?? t('organizer.leagues.manage.roles.unknownUser')}
                    </p>
                    <p className="text-xs text-muted">{r.role}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeUserRole(r.userId)}
                    disabled={busy}
                    className="shrink-0 rounded-md border border-danger/40 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {t('organizer.leagues.manage.roles.removeButton')}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{t('organizer.leagues.manage.roles.note')}</p>
          </div>
        </section>
      )}
    </main>
  );
}
