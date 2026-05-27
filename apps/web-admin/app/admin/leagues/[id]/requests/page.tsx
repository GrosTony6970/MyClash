'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminPageHeader } from '@myclash/ui';
import { LeagueRequestsPanel } from '../../../../../src/components/league/LeagueRequestsPanel';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LeagueRow {
  id: string;
  name: string;
  slug: string;
}

export default function LeagueRequestsStandalonePage() {
  const params = useParams<{ id: string }>();
  const leagueId = params.id;

  const [league, setLeague] = useState<LeagueRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${apiUrl}/api/v1/admin/leagues`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Could not load league');
        return r.json() as Promise<LeagueRow[]>;
      })
      .then((rows) => {
        const found = rows.find((r) => r.id === leagueId);
        if (!found) {
          setError('League not found');
          return;
        }
        setLeague(found);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [leagueId]);

  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Leagues"
        title={league ? `${league.name} — Requests` : 'League requests'}
        subtitle="Accept or refuse tournament-attach and membership requests for this league."
        actions={
          <div className="flex gap-2">
            <Link
              href={`/admin/leagues/${leagueId}/edit`}
              className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Edit league
            </Link>
            <Link
              href="/admin/leagues"
              className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← All leagues
            </Link>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <LeagueRequestsPanel leagueId={leagueId} standalone />
    </main>
  );
}
