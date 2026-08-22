'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import {
  ScoringSystemForm,
  type ScoringSystemFormValues,
} from '../../_components/LeagueScoringSystemForm';
import { VersionHistory } from '../../_components/VersionHistory';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

interface ScoringSystemRow {
  id: string;
  code: string;
  name: string;
  version?: string;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
}

export default function EditScoringSystemPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [initial, setInitial] = useState<ScoringSystemFormValues | null>(null);
  const [row, setRow] = useState<ScoringSystemRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The list endpoint returns active rows; archived rows aren't editable.
    void apiRequest<ScoringSystemRow[]>(apiUrl, '/api/v1/admin/league-scoring-systems').then(
      (r) => {
        if (!r.ok) {
          const message = failureMessage(r, t, t('admin.rulesets.league.form.loadError'));
          if (message) setError(message);
          return;
        }
        const found = r.data.find((row) => row.id === id);
        if (!found) {
          setError(t('admin.rulesets.league.form.notFound'));
          return;
        }
        setRow(found);
        setInitial({
          id: found.id,
          code: found.code,
          name: found.name,
          description: found.description ?? '',
          pointsByRank: found.points_by_rank,
          tieBreakers: found.tie_breakers,
        });
      },
    );
  }, [id, t]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      </main>
    );
  }
  if (!initial || !row) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12 text-sm text-muted">
        {t('admin.rulesets.league.loadingState')}
      </main>
    );
  }
  return (
    <>
      <ScoringSystemForm mode="edit" initial={initial} />
      <div className="mx-auto w-full max-w-2xl px-6 pb-12 lg:px-8">
        <VersionHistory systemId={row.id} currentVersion={row.version ?? null} />
      </div>
    </>
  );
}
