'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { SegmentedTabs, useToast } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { LeagueAttachmentsSection } from './_components/LeagueAttachmentsSection';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();
const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
}

interface LeagueRow {
  id: string;
  name: string;
  slug: string;
  season_year: number;
  description: string | null;
  status: string;
  public_visibility: boolean;
}

interface ManagedLeagueRow extends LeagueRow {
  org_role?: string | null;
  joined_at?: string | null;
  tournament_count?: number;
  group_count?: number;
  fighter_count?: number;
}

type LeaguesTab = 'membership' | 'manage' | 'discover';

function isTabKey(value: string | null): value is LeaguesTab {
  return value === 'membership' || value === 'manage' || value === 'discover';
}

interface MembershipRequestRow {
  id: string;
  league_id: string;
  organization_id: string;
  requested_role: string;
  status: 'requested' | 'approved' | 'rejected' | 'withdrawn';
  message: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  leagues?: { id: string; name: string | null; slug: string | null } | null;
}

/** Tailwind classes for the role pill; admin/owner share the accent tone. */
function roleBadgeClass(role: string | null | undefined): string {
  return role === 'admin' || role === 'owner'
    ? 'bg-accent/10 text-accent'
    : 'bg-success/10 text-success';
}

export default function OrgLeaguesPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ slug: string }>();
  const orgSlug = params.slug;
  const toast = useToast();

  const [org, setOrg] = useState<OrgRow | null>(null);
  const [tab, setTab] = useState<LeaguesTab>('membership');
  const [memberships, setMemberships] = useState<ManagedLeagueRow[]>([]);
  const [managed, setManaged] = useState<ManagedLeagueRow[]>([]);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [requests, setRequests] = useState<MembershipRequestRow[]>([]);
  const [memberOfLeagueIds, setMemberOfLeagueIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Org row → orgId. Public endpoint.
      const orgRes = await fetch(
        `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(orgSlug)}`,
        { credentials: 'include' },
      );
      if (!orgRes.ok) throw new Error(t('organizer.leagues.orgLoadError'));
      const orgData = (await orgRes.json()) as Record<string, unknown>;
      const orgRow: OrgRow = {
        id: String(orgData['id']),
        name: String(orgData['name'] ?? orgSlug),
        slug: String(orgData['slug'] ?? orgSlug),
      };
      setOrg(orgRow);

      // Every league this org belongs to, at any role. Canonical source of
      // truth for both the Membership tab and the Discover button state — it
      // includes member-role leagues and super-admin direct adds that have no
      // request row (the reported gap).
      const memRes = await fetch(`${apiUrl}/api/v1/organizations/${orgRow.id}/league-memberships`, {
        credentials: 'include',
      });
      const memData = memRes.ok ? ((await memRes.json()) as ManagedLeagueRow[]) : [];
      setMemberships(memData);
      setMemberOfLeagueIds(new Set(memData.map((l) => l.id)));

      // Leagues this org manages (admin/owner role). Powers the Manage tab.
      const managedRes = await fetch(`${apiUrl}/api/v1/organizations/${orgRow.id}/leagues`, {
        credentials: 'include',
      });
      setManaged(managedRes.ok ? ((await managedRes.json()) as ManagedLeagueRow[]) : []);

      // Public leagues list.
      const leaguesRes = await fetch(`${apiUrl}/api/v1/leagues`, { credentials: 'include' });
      const leaguesData = leaguesRes.ok ? ((await leaguesRes.json()) as LeagueRow[]) : [];
      setLeagues(leaguesData);

      // This org's existing membership requests (drives the pending badge +
      // the Discover "Pending requests" section and withdraw).
      const reqRes = await fetch(`${apiUrl}/api/v1/orgs/${orgRow.id}/league-requests`, {
        credentials: 'include',
      });
      setRequests(reqRes.ok ? ((await reqRes.json()) as MembershipRequestRow[]) : []);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.leagues.leaguesLoadError'));
    } finally {
      setLoading(false);
    }
  }, [orgSlug, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; setState runs in promise callback, not synchronously
    void loadAll();
  }, [loadAll]);

  // Deep-link `?tab=` support without next/navigation's useSearchParams — that
  // hook makes the React Compiler bail out of the component, which in turn
  // breaks the manual memoization on loadAll. Reading/writing the query via the
  // window APIs keeps the compiler happy. Read once on mount; the Stage-2
  // redirect from the retired event-scoped page lands here with ?tab=membership.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time deep-link read on mount
    if (isTabKey(q)) setTab(q);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [tab]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'requested'),
    [requests],
  );
  const pendingByLeagueId = useMemo(() => {
    const map = new Map<string, MembershipRequestRow>();
    for (const r of pendingRequests) map.set(r.league_id, r);
    return map;
  }, [pendingRequests]);
  const roleByLeagueId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of memberships) if (m.org_role) map.set(m.id, m.org_role);
    return map;
  }, [memberships]);

  async function submitJoin(leagueId: string) {
    if (!org) return;
    setBusyLeagueId(leagueId);
    try {
      const body = {
        leagueId,
        message: messageDraft[leagueId]?.trim() || undefined,
        requestedRole: 'member' as const,
      };
      const res = await fetch(`${apiUrl}/api/v1/orgs/${org.id}/league-requests`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? t('organizer.leagues.joinFailedToast'));
      }
      toast.success(t('organizer.leagues.joinSuccessToast'));
      setMessageDraft((prev) => {
        const next = { ...prev };
        delete next[leagueId];
        return next;
      });
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.leagues.joinFailedToast'));
    } finally {
      setBusyLeagueId(null);
    }
  }

  async function withdraw(requestId: string) {
    if (!org) return;
    setBusyLeagueId(requestId);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/orgs/${org.id}/league-requests/${requestId}/withdraw`,
        { method: 'PATCH', credentials: 'include' },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? t('organizer.leagues.withdrawFailedToast'));
      }
      toast.success(t('organizer.leagues.withdrawSuccessToast'));
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.leagues.withdrawFailedToast'));
    } finally {
      setBusyLeagueId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[110rem] px-6 py-12 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.leagues.eyebrow')}
        </p>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {org?.name
            ? t('organizer.leagues.titleWithOrg', { name: org.name })
            : t('organizer.leagues.titleFallback')}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{t('organizer.leagues.subtitle')}</p>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <SegmentedTabs
        tabs={[
          { value: 'membership' as const, label: t('organizer.leagues.tabMembership') },
          { value: 'manage' as const, label: t('organizer.leagues.manage.tabManage') },
          { value: 'discover' as const, label: t('organizer.leagues.tabDiscover') },
        ]}
        value={tab}
        onChange={setTab}
        aria-label={t('organizer.leagues.eyebrow')}
        className="mb-6 max-w-xl"
      />

      {tab === 'membership' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.leagues.membership.heading')}
          </h2>
          {loading && <p className="text-sm text-muted">{t('organizer.leagues.loadingState')}</p>}
          {!loading && memberships.length === 0 && (
            <p className="text-sm text-muted">{t('organizer.leagues.membership.empty')}</p>
          )}
          <ul className="divide-y divide-border">
            {memberships.map((league) => {
              const role = league.org_role ?? 'member';
              const canManage = role === 'admin' || role === 'owner';
              const roleKey = canManage ? role : 'member';
              const canViewPublic = league.public_visibility;
              return (
                <li key={league.id} className="py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {league.name}
                        <span className="ml-2 font-mono text-xs text-muted">
                          {league.season_year}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t('organizer.leagues.manage.listCounts', {
                          tournaments: league.tournament_count ?? 0,
                          groups: league.group_count ?? 0,
                        })}
                        {league.joined_at && (
                          <>
                            {' · '}
                            {t('organizer.leagues.joinedAt', {
                              date: new Date(league.joined_at).toLocaleDateString(
                                localeToBcp47(locale),
                              ),
                            })}
                          </>
                        )}
                      </p>
                      {!canManage && !canViewPublic && (
                        <p className="mt-1 text-xs text-muted">
                          {t('organizer.leagues.memberOnlyNote')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${roleBadgeClass(role)}`}
                      >
                        {t(`organizer.leagues.roleBadge.${roleKey}`)}
                      </span>
                      {canManage ? (
                        <Link
                          href={`/org/${orgSlug}/leagues/${league.id}`}
                          className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-accent hover:bg-background"
                        >
                          {t('organizer.leagues.manage.manageLink')}
                        </Link>
                      ) : canViewPublic ? (
                        <a
                          href={`${publicAppUrl}/leagues/${league.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground-secondary hover:bg-background"
                        >
                          {t('organizer.leagues.viewPublicLeague')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {org && <LeagueAttachmentsSection orgId={org.id} leagueId={league.id} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tab === 'manage' && (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.leagues.manage.listHeading')}
          </h2>
          {loading && <p className="text-sm text-muted">{t('organizer.leagues.loadingState')}</p>}
          {!loading && managed.length === 0 && (
            <p className="text-sm text-muted">{t('organizer.leagues.manage.listEmpty')}</p>
          )}
          <ul className="divide-y divide-border">
            {managed.map((league) => (
              <li key={league.id}>
                <Link
                  href={`/org/${orgSlug}/leagues/${league.id}`}
                  className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-background"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {league.name}
                      <span className="ml-2 font-mono text-xs text-muted">
                        {league.season_year}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t('organizer.leagues.manage.listCounts', {
                        tournaments: league.tournament_count ?? 0,
                        groups: league.group_count ?? 0,
                      })}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-accent">
                    {t('organizer.leagues.manage.manageLink')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'discover' && (
        <>
          {/* Existing requests */}
          {pendingRequests.length > 0 && (
            <section className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.leagues.pendingHeading')}
              </h2>
              <ul className="space-y-2">
                {pendingRequests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded border border-border bg-background px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {r.leagues?.name ?? r.league_id}
                      </p>
                      <p className="text-xs text-muted">
                        {t('organizer.leagues.requestedAt', {
                          date: new Date(r.requested_at).toLocaleDateString(localeToBcp47(locale)),
                        })}
                        {r.message && <> · &ldquo;{r.message}&rdquo;</>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void withdraw(r.id)}
                      disabled={busyLeagueId === r.id}
                      className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background disabled:opacity-50"
                    >
                      {t('organizer.leagues.withdrawButton')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* All leagues */}
          <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.leagues.availableHeading')}
            </h2>
            {loading && <p className="text-sm text-muted">{t('organizer.leagues.loadingState')}</p>}
            {!loading && leagues.length === 0 && (
              <p className="text-sm text-muted">{t('organizer.leagues.emptyState')}</p>
            )}
            <ul className="divide-y divide-border">
              {leagues.map((league) => {
                const alreadyMember = memberOfLeagueIds.has(league.id);
                const role = roleByLeagueId.get(league.id);
                const isManageRole = role === 'admin' || role === 'owner';
                const pending = pendingByLeagueId.get(league.id);
                return (
                  <li
                    key={league.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {league.name}
                        <span className="ml-2 text-xs font-mono text-muted">
                          {league.season_year}
                        </span>
                      </p>
                      {league.description && (
                        <p className="mt-0.5 text-xs text-muted">{league.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {alreadyMember ? (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${roleBadgeClass(role)}`}
                        >
                          {isManageRole && role
                            ? t(`organizer.leagues.roleBadge.${role}`)
                            : t('organizer.leagues.memberBadge')}
                        </span>
                      ) : pending ? (
                        <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
                          {t('organizer.leagues.pendingBadge')}
                        </span>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={messageDraft[league.id] ?? ''}
                            onChange={(e) =>
                              setMessageDraft((prev) => ({ ...prev, [league.id]: e.target.value }))
                            }
                            placeholder={t('organizer.leagues.messagePlaceholder')}
                            className="w-44 rounded border border-border px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void submitJoin(league.id)}
                            disabled={busyLeagueId === league.id}
                            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
                          >
                            {t('organizer.leagues.requestToJoinButton')}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
