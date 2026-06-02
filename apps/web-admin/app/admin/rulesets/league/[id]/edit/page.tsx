'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ScoringSystemForm,
  type ScoringSystemFormValues,
} from '../../_components/LeagueScoringSystemForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface ScoringSystemRow {
  id: string;
  code: string;
  name: string;
  is_builtin: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
}

export default function EditScoringSystemPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [initial, setInitial] = useState<ScoringSystemFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The list endpoint returns active rows; archived rows aren't editable.
    void fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Could not load scoring system');
        return r.json() as Promise<ScoringSystemRow[]>;
      })
      .then((rows) => {
        const found = rows.find((r) => r.id === id);
        if (!found) {
          setError('Scoring system not found');
          return;
        }
        setInitial({
          id: found.id,
          code: found.code,
          name: found.name,
          description: found.description ?? '',
          pointsByRank: found.points_by_rank,
          tieBreakers: found.tie_breakers,
          isBuiltin: found.is_builtin,
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [id]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }
  if (!initial) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12 text-sm text-slate-500">Loading…</main>
    );
  }
  return <ScoringSystemForm mode="edit" initial={initial} />;
}
