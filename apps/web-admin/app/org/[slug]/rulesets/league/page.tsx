'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AdminPageHeader,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  Modal,
  RowActionButton,
} from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { RulesetsTopNav } from '../../../../../src/components/rulesets/RulesetsTopNav';
import { ScoringSystemPreview } from '../../../../../src/components/league/ScoringSystemPreview';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

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

  return (
    <main className="mx-auto w-full max-w-[110rem] px-6 py-8 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.shell.eyebrow')}
        title={t('admin.rulesets.league.title')}
        subtitle={t('admin.rulesets.league.orgSubtitle')}
      />
      <RulesetsTopNav active="league" basePath={`/org/${slug}/rulesets`} />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.name')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.code')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.version')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.source')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.league.columns.points')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.league.columns.tieBreakers')}</DataTableCell>
            <DataTableCell as="th">{t('admin.rulesets.shared.columns.actions')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {rows.map((row) => {
              const ranks = Object.keys(row.points_by_rank)
                .map(Number)
                .filter((n) => Number.isInteger(n) && n > 0)
                .sort((a, b) => a - b);
              return (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <div className="font-semibold text-foreground">{row.name}</div>
                    {row.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted">
                        {row.description}
                      </div>
                    )}
                  </DataTableCell>
                  <DataTableCell mono>{row.code}</DataTableCell>
                  <DataTableCell mono className="font-bold">
                    {row.version}
                  </DataTableCell>
                  <DataTableCell>
                    {row.is_builtin ? (
                      <span className="rounded bg-success/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-success">
                        {t('admin.rulesets.shared.badges.builtin')}
                      </span>
                    ) : (
                      <span className="rounded bg-background px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                        {t('admin.rulesets.shared.badges.custom')}
                      </span>
                    )}
                  </DataTableCell>
                  <DataTableCell mono>
                    {ranks.length > 0
                      ? ranks.map((r) => row.points_by_rank[String(r)]).join(' / ')
                      : '—'}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-foreground-secondary">
                    {row.tie_breakers.length > 0
                      ? row.tie_breakers
                          .map((tb) => t(`admin.rulesets.league.form.tieBreakerLabels.${tb}`))
                          .join(' · ')
                      : '—'}
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <RowActionButton variant="neutral" onClick={() => setViewRow(row)}>
                        {t('admin.rulesets.viewAction')}
                      </RowActionButton>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      )}

      {viewRow && (
        <Modal
          open
          onClose={() => setViewRow(null)}
          size="lg"
          title={viewRow.name}
          footer={
            <RowActionButton variant="neutral" onClick={() => setViewRow(null)}>
              {t('actions.close')}
            </RowActionButton>
          }
        >
          <ScoringSystemPreview
            name={viewRow.name}
            code={viewRow.code}
            version={viewRow.version}
            description={viewRow.description}
            pointsByRank={viewRow.points_by_rank}
            tieBreakers={viewRow.tie_breakers}
          />
        </Modal>
      )}
    </main>
  );
}
