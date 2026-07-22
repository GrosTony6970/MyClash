'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { useI18n } from '../../i18n/I18nProvider';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface PenaltyVersionRow {
  id: string;
  version: string;
  published_at: string;
  is_frozen: boolean;
}

interface Props {
  rulesetId: string;
  currentVersion: string | null;
}

/**
 * Version-history panel for a custom penalty ruleset (mounted below the edit
 * form). Publishes the current definition as an immutable snapshot + version
 * bump, lists the published snapshots newest-first (with the pinned/frozen
 * badge), and rolls the parent back to any snapshot. Rollback of a ruleset a
 * tournament already pins is refused server-side (409) and surfaced as a toast.
 * Not mounted for the built-in ruleset (publish/rollback are refused there).
 */
export function PenaltyVersionHistory({ rulesetId, currentVersion }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const base = `${apiUrl}/api/v1/penalty-rulesets/${rulesetId}`;

  const [versions, setVersions] = useState<PenaltyVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRollback, setPendingRollback] = useState<PenaltyVersionRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${base}/versions`, { credentials: 'include' });
      if (!res.ok) throw new Error(t('admin.penaltyRulesets.versionHistory.loadError'));
      setVersions((await res.json()) as PenaltyVersionRow[]);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.penaltyRulesets.versionHistory.loadError'),
      );
    }
  }, [base, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload() fetches then sets state; intentional initial data load
    void reload();
  }, [reload]);

  async function publish() {
    setPublishing(true);
    try {
      const res = await fetch(`${base}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.penaltyRulesets.versionHistory.publishError'));
      }
      toast.success(t('admin.penaltyRulesets.versionHistory.publishSuccess'));
      window.location.reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('admin.penaltyRulesets.versionHistory.publishError'),
      );
      setPublishing(false);
    }
  }

  async function confirmRollback() {
    if (!pendingRollback) return;
    setBusyId(pendingRollback.id);
    try {
      const res = await fetch(`${base}/rollback`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: pendingRollback.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.penaltyRulesets.versionHistory.rollbackError'));
      }
      toast.success(
        t('admin.penaltyRulesets.versionHistory.rollbackSuccess', {
          version: pendingRollback.version,
        }),
      );
      setPendingRollback(null);
      window.location.reload();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('admin.penaltyRulesets.versionHistory.rollbackError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  // Initial load failed (e.g. a transient error, or a non-admin who can open the
  // form but not manage the ruleset): show the reason rather than silently
  // vanishing the whole panel. `null` only while the first load is still pending.
  if (!versions) {
    return error ? (
      <section className="mt-8 rounded-md border border-border bg-surface">
        <p className="px-4 py-3 text-sm text-danger">{error}</p>
      </section>
    ) : null;
  }

  return (
    <section className="mt-8 rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground-secondary">
          {t('admin.penaltyRulesets.versionHistory.title')} ({versions.length})
        </h2>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={publishing}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {t('admin.penaltyRulesets.versionHistory.publishButton')}
        </button>
      </div>

      {error && (
        <div className="border-t border-border bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted">
          {t('admin.penaltyRulesets.versionHistory.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">
                  {t('admin.adminRulesetsReview.versionLabel', { version: v.version })}
                </span>
                {v.version === currentVersion && (
                  <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                    {t('admin.adminRulesetsReview.current')}
                  </span>
                )}
                {v.is_frozen && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                    {t('admin.penaltyRulesets.versionHistory.frozenBadge')}
                  </span>
                )}
                <span className="text-xs text-muted">
                  {t('admin.penaltyRulesets.versionHistory.publishedAt', {
                    date: new Date(v.published_at).toLocaleString(),
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingRollback(v)}
                disabled={busyId === v.id}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {t('admin.penaltyRulesets.versionHistory.rollbackButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRollback !== null}
        title={
          pendingRollback
            ? t('admin.penaltyRulesets.versionHistory.rollbackConfirmTitle', {
                version: pendingRollback.version,
              })
            : ''
        }
        description={
          pendingRollback
            ? t('admin.penaltyRulesets.versionHistory.rollbackConfirmBody', {
                version: pendingRollback.version,
              })
            : ''
        }
        confirmLabel={t('admin.penaltyRulesets.versionHistory.rollbackConfirmAction')}
        danger
        busy={busyId === pendingRollback?.id}
        onCancel={() => setPendingRollback(null)}
        onConfirm={() => void confirmRollback()}
      />
    </section>
  );
}
