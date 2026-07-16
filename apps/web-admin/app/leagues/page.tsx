'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LeagueAccess {
  direct_role: string | null;
  organizations: Array<{ id: string; name: string; role: string }>;
  super_admin: boolean;
}

interface ManageableLeague {
  id: string;
  slug: string;
  name: string;
  season_year: number;
  status: string;
  tournament_count?: number;
  group_count?: number;
  access?: LeagueAccess;
}

/**
 * Every league the signed-in account manages, however it manages them. The nav
 * entry that leads here is gated on a personal grant only, so this list is
 * intentionally wider than its entrance — the access badge is what makes that
 * difference visible instead of looking like a bug.
 */
export default function PersonalLeaguesPage() {
  const { t } = useI18n();
  const [leagues, setLeagues] = useState<ManageableLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' });
      if (!res.ok) throw new Error(t('admin.common.loadLeaguesFailed'));
      setLeagues((await res.json()) as ManageableLeague[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.loadLeaguesFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; state set after await, not synchronously
    void load();
  }, [load]);

  function accessLabel(access: LeagueAccess | undefined): string | null {
    if (!access) return null;
    if (access.direct_role) return t('leagueWorkspace.list.viaDirect');
    const org = access.organizations[0];
    if (org) return t('leagueWorkspace.list.viaOrg', { organization: org.name });
    if (access.super_admin) return t('leagueWorkspace.list.viaSuperAdmin');
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('organizer.leagues.manage.listHeading')}
        </h1>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        {loading && (
          <p className="text-sm text-muted">{t('organizer.leagues.manage.loadingState')}</p>
        )}
        {!loading && leagues.length === 0 && !error && (
          <p className="text-sm text-muted">{t('leagueWorkspace.list.empty')}</p>
        )}
        <ul className="divide-y divide-border">
          {leagues.map((league) => {
            const badge = accessLabel(league.access);
            return (
              <li key={league.id}>
                <Link
                  href={`/leagues/${league.id}`}
                  className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-background"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {league.name}
                      <span className="ml-2 font-mono text-xs text-muted">
                        {league.season_year}
                      </span>
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted">/{league.slug}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t('organizer.leagues.manage.listCounts', {
                        tournaments: league.tournament_count ?? 0,
                        groups: league.group_count ?? 0,
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {badge && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                        {badge}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-accent">
                      {t('organizer.leagues.manage.manageLink')}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
