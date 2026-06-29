'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useToast } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

export default function OrgLeaguesPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const orgSlug = params.slug;
  const toast = useToast();

  const [org, setOrg] = useState<OrgRow | null>(null);
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

      // Public leagues list.
      const leaguesRes = await fetch(`${apiUrl}/api/v1/leagues`, { credentials: 'include' });
      const leaguesData = leaguesRes.ok ? ((await leaguesRes.json()) as LeagueRow[]) : [];
      setLeagues(leaguesData);

      // This org's existing membership requests.
      const reqRes = await fetch(`${apiUrl}/api/v1/orgs/${orgRow.id}/league-requests`, {
        credentials: 'include',
      });
      if (reqRes.ok) {
        const data = (await reqRes.json()) as MembershipRequestRow[];
        setRequests(data);
      }

      // Which leagues this org is already a member of — we read the
      // admin org-roles endpoint per league. For the public-facing flow
      // we infer membership from approved request rows; a freshly-added
      // org without a request row will still see the join button, and
      // the backend rejects the duplicate.
      const approvedLeagueIds = new Set<string>();
      if (reqRes.ok) {
        const data = (await reqRes.json().catch(() => [])) as MembershipRequestRow[];
        for (const r of data) {
          if (r.status === 'approved') approvedLeagueIds.add(r.league_id);
        }
      }
      setMemberOfLeagueIds(approvedLeagueIds);
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

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'requested'),
    [requests],
  );
  const pendingByLeagueId = useMemo(() => {
    const map = new Map<string, MembershipRequestRow>();
    for (const r of pendingRequests) map.set(r.league_id, r);
    return map;
  }, [pendingRequests]);

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
    <main className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8">
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
                  <p className="font-medium text-foreground">{r.leagues?.name ?? r.league_id}</p>
                  <p className="text-xs text-muted">
                    {t('organizer.leagues.requestedAt', {
                      date: new Date(r.requested_at).toLocaleDateString(),
                    })}
                    {r.message && <> · "{r.message}"</>}
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
            const pending = pendingByLeagueId.get(league.id);
            return (
              <li key={league.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {league.name}
                    <span className="ml-2 text-xs font-mono text-muted">{league.season_year}</span>
                  </p>
                  {league.description && (
                    <p className="mt-0.5 text-xs text-muted">{league.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {alreadyMember ? (
                    <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                      {t('organizer.leagues.memberBadge')}
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
    </main>
  );
}
