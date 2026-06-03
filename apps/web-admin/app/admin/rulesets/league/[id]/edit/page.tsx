'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  ScoringSystemForm,
  type ScoringSystemFormValues,
} from '../../_components/LeagueScoringSystemForm';
import { VersionHistory } from '../../_components/VersionHistory';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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
    void fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(t('admin.rulesets.league.form.loadError'));
        return r.json() as Promise<ScoringSystemRow[]>;
      })
      .then((rows) => {
        const found = rows.find((r) => r.id === id);
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
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('admin.rulesets.league.form.loadError')),
      );
  }, [id, t]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }
  if (!initial || !row) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12 text-sm text-slate-500">
        {t('admin.rulesets.league.loadingState')}
      </main>
    );
  }
  return (
    <>
      <ScoringSystemForm mode="edit" initial={initial} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-12 lg:px-8">
        <VersionHistory systemId={row.id} currentVersion={row.version ?? null} />
      </div>
    </>
  );
}
