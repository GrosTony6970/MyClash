'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminPageHeader } from '@myclash/ui';
import { LeagueRequestsPanel } from '../../../../../src/components/league/LeagueRequestsPanel';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LeagueRow {
  id: string;
  name: string;
  slug: string;
}

export default function LeagueRequestsStandalonePage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const leagueId = params.id;

  const [league, setLeague] = useState<LeagueRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(t('admin.leagues.requestsPage.loadError'));
        return r.json() as Promise<LeagueRow[]>;
      })
      .then((rows) => {
        const found = rows.find((r) => r.id === leagueId);
        if (!found) {
          setError(t('admin.leagues.requestsPage.notFound'));
          return;
        }
        setLeague(found);
      })
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : t('admin.leagues.requestsPage.loadFailedFallback'),
        ),
      );
  }, [leagueId, t]);

  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.leagues.requestsPage.eyebrow')}
        title={
          league
            ? t('admin.leagues.requestsPage.titleWithLeague', { name: league.name })
            : t('admin.leagues.requestsPage.titleFallback')
        }
        subtitle={t('admin.leagues.requestsPage.subtitle')}
        actions={
          <div className="flex gap-2">
            <Link
              href={`/admin/leagues/${leagueId}/edit`}
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
            >
              {t('admin.leagues.requestsPage.editLink')}
            </Link>
            <Link
              href="/admin/leagues"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
            >
              {t('admin.leagues.requestsPage.allLink')}
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <LeagueRequestsPanel leagueId={leagueId} standalone />
    </main>
  );
}
