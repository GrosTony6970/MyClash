'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { ScoringSystemPreview } from './ScoringSystemPreview';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface VersionRow {
  id: string;
  league_scoring_system_id: string;
  version: string;
  name: string;
  points_by_rank: Record<string, number>;
  tie_breakers: string[];
  description: string | null;
  published_at: string;
  published_by_user_id: string | null;
}

interface Props {
  systemId: string;
  currentVersion: string | null;
}

/**
 * Collapsible version-history panel rendered on the scoring-system edit
 * page. Lists past versions newest-first, each expandable to a
 * ScoringSystemPreview of the snapshot's values. A Rollback button on
 * each non-current row creates a new latest version with the snapshot's
 * values (the original snapshot is preserved; rollback is additive).
 *
 * Hidden on built-in rows (caller decides via mounting). Hidden visually
 * when there's only one version (the initial 1.0.0).
 */
export function VersionHistory({ systemId, currentVersion }: Props) {
  const { t } = useI18n();
  const toast = useToast();

  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingRollback, setPendingRollback] = useState<VersionRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${systemId}/versions`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('admin.rulesets.league.versionHistory.loadError'));
      const data = (await res.json()) as VersionRow[];
      setVersions(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.rulesets.league.versionHistory.loadError'),
      );
    }
  }, [systemId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function confirmRollback() {
    if (!pendingRollback) return;
    setBusyId(pendingRollback.id);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/league-scoring-systems/${systemId}/versions/${pendingRollback.id}/rollback`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.league.versionHistory.rollbackError'));
      }
      toast.success(
        t('admin.rulesets.league.versionHistory.rollbackSuccess', {
          version: pendingRollback.version,
        }),
      );
      setPendingRollback(null);
      // Reload the page so the form picks up the new current values
      // and the version-history list updates.
      window.location.reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('admin.rulesets.league.versionHistory.rollbackError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!versions) {
    return null; // Not yet loaded — silent
  }

  // Hide the panel entirely when there's only the initial version.
  if (versions.length < 2) {
    return null;
  }

  return (
    <details className="mt-8 rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        {t('admin.rulesets.league.versionHistory.title')} ({versions.length})
      </summary>

      {error && (
        <div className="border-t border-slate-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <ul className="divide-y divide-slate-200 border-t border-slate-200">
        {versions.map((v) => {
          const isCurrent = v.version === currentVersion;
          const isExpanded = expandedId === v.id;
          return (
            <li key={v.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    v{v.version}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      current
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    {t('admin.rulesets.league.versionHistory.publishedAt', {
                      date: new Date(v.published_at).toLocaleString(),
                    })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : v.id)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => setPendingRollback(v)}
                      disabled={busyId === v.id}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      {t('admin.rulesets.league.versionHistory.rollbackButton')}
                    </button>
                  )}
                </div>
              </div>
              {isExpanded && (
                <div className="mt-3">
                  <ScoringSystemPreview
                    name={v.name}
                    version={v.version}
                    description={v.description}
                    pointsByRank={v.points_by_rank}
                    tieBreakers={v.tie_breakers}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingRollback !== null}
        title={
          pendingRollback
            ? t('admin.rulesets.league.versionHistory.rollbackConfirmTitle', {
                version: pendingRollback.version,
              })
            : ''
        }
        description={
          pendingRollback
            ? t('admin.rulesets.league.versionHistory.rollbackConfirmBody', {
                version: pendingRollback.version,
              })
            : ''
        }
        confirmLabel={t('admin.rulesets.league.versionHistory.rollbackConfirmAction')}
        danger
        busy={busyId === pendingRollback?.id}
        onCancel={() => setPendingRollback(null)}
        onConfirm={() => void confirmRollback()}
      />
    </details>
  );
}
