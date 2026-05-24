'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';

interface RulesetSummary {
  code: string;
  version: string;
  label: string;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Organizer-side scoring rulesets tab (Round 1 — read-only catalog).
 *
 * Lists the platform's registered scoring rulesets (TF_v1, Generic_PointsCap,
 * plus any published custom rulesets exposed via /api/v1/rulesets). This is
 * the same catalog the tournament-creation wizard's step-1 ruleset picker
 * pulls from, surfaced here so organizers can browse what's available before
 * choosing one for a tournament.
 *
 * Round 2 will add a "Create scoring ruleset" CTA + submission-for-review
 * workflow. For now the page is intentionally read-only.
 */
export default function OrgScoringRulesetsPage() {
  const params = useParams<{ slug: string }>();
  const { t } = useI18n();

  const [rows, setRows] = useState<RulesetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/rulesets`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.curatedLoadError'));
        return (await res.json()) as RulesetSummary[];
      })
      .then((data) => setRows(data ?? []))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('admin.rulesets.curatedLoadError'));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [t]);

  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('admin.rulesets.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('admin.rulesets.description')}</p>
      </div>

      <RulesetsTopNav active="scoring" basePath={`/org/${params.slug}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{t('admin.rulesets.curatedTitle')}</h2>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.curatedEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">{t('admin.rulesets.colName')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colCode')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colVersion')}</th>
                <th className="px-4 py-2">{t('admin.rulesets.colSource')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.code}:${row.version}`} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-slate-800">{row.label}</div>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.code}</td>
                  <td className="px-4 py-2 font-mono text-xs font-bold text-slate-700">
                    {row.version}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                      {t('admin.rulesets.sourceSystem')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs italic text-slate-500">
        {t('organizer.shell.scoringRulesetsAuthoringSoon')}
      </p>
    </main>
  );
}
