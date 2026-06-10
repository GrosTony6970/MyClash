'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminPageHeader, RowActionButton } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { ScoringSystemPreview } from '../../../../admin/rulesets/league/_components/ScoringSystemPreview';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface LeagueScoringSystemRow {
  id: string;
  code: string;
  name: string;
  version: string;
  is_builtin: boolean;
  is_default: boolean;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
}

/**
 * Organizer-side league scoring systems tab. League systems are
 * platform-managed (no org ownership), so this is read-only: the table
 * matches the scoring/penalty tabs and each row offers a "View" that opens a
 * read-only details panel. Cloning isn't offered — orgs can't own a copy.
 */
export default function OrgLeagueScoringSystemsPage() {
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [rows, setRows] = useState<LeagueScoringSystemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<LeagueScoringSystemRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/admin/league-scoring-systems`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.league.loadError'));
        return (await res.json()) as LeagueScoringSystemRow[];
      })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t('admin.rulesets.league.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Escape closes the view modal (keyboard-accessible dismissal).
  useEffect(() => {
    if (!viewRow) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setViewRow(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewRow]);

  return (
    <main id="main-content" className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.shell.eyebrow')}
        title={t('admin.rulesets.league.title')}
        subtitle={t('admin.rulesets.league.orgSubtitle')}
      />
      <RulesetsTopNav active="league" basePath={`/org/${slug}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.name')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.code')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.version')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.source')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.league.columns.points')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.league.columns.tieBreakers')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.shared.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ranks = Object.keys(row.points_by_rank)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n > 0)
                  .sort((a, b) => a - b);
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{row.name}</div>
                      {row.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.code}</td>
                    <td className="px-4 py-2 font-mono text-xs font-bold text-slate-700">
                      {row.version}
                    </td>
                    <td className="px-4 py-2">
                      {row.is_builtin ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                          {t('admin.rulesets.shared.badges.builtin')}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          {t('admin.rulesets.shared.badges.custom')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {ranks.length > 0
                        ? ranks.map((r) => row.points_by_rank[String(r)]).join(' / ')
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {row.tie_breakers.length > 0
                        ? row.tie_breakers
                            .map((tb) => t(`admin.rulesets.league.form.tieBreakerLabels.${tb}`))
                            .join(' · ')
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <RowActionButton variant="neutral" onClick={() => setViewRow(row)}>
                          {t('admin.rulesets.viewAction')}
                        </RowActionButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{viewRow.name}</h2>
              <button
                type="button"
                onClick={() => setViewRow(null)}
                aria-label={t('actions.close')}
                className="text-2xl leading-none text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            <ScoringSystemPreview
              name={viewRow.name}
              code={viewRow.code}
              version={viewRow.version}
              description={viewRow.description}
              pointsByRank={viewRow.points_by_rank}
              tieBreakers={viewRow.tie_breakers}
            />
            <div className="mt-4 flex justify-end">
              <RowActionButton variant="neutral" onClick={() => setViewRow(null)}>
                {t('actions.close')}
              </RowActionButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
