'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import type {
  FormulaConstants,
  FormulaNode,
  RankingRule,
  RulesetMetadata,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
  DEFAULT_TF_V1_INTERNALS,
  type MatchFormatDefaults,
  type RulesetFormValue,
  type TfV1Internals,
} from '../../../../../../src/components/rulesets/RulesetForm';

interface TfConfigOverride {
  winBonus?: number;
  targetValues?: { deepTarget?: number; shallowTarget?: number };
  matchFormat?: Partial<MatchFormatDefaults>;
  doublePenaltyFormula?: string;
  // forfeitPolicy intentionally not exposed in the UI yet
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface CustomRulesetDetail {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  tiebreakers: Tiebreaker[];
  match_format_defaults: Partial<MatchFormatDefaults> | null;
  double_penalty_formula: string | null;
  tf_config: TfConfigOverride | null;
  is_default: boolean;
  is_system: boolean;
  systemRankingChain?: RankingRule[];
  systemMetadata?: RulesetMetadata;
}

interface VersionSnapshot {
  id: string;
  version: string;
  name: string;
  published_at: string;
  published_by_user_id: string | null;
  is_frozen: boolean;
}

export default function EditRulesetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<
    | (RulesetFormValue & {
        code: string;
        isSystem: boolean;
        systemRankingChain?: RankingRule[];
        systemMetadata?: RulesetMetadata;
      })
    | null
  >(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}/versions`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('admin.rulesets.versionHistoryLoadError'));
      const data = (await res.json()) as VersionSnapshot[];
      setVersions(data);
      setVersionsError(null);
    } catch (err) {
      setVersionsError(
        err instanceof Error ? err.message : t('admin.rulesets.versionHistoryLoadError'),
      );
    }
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.loadOneError'));
        return (await res.json()) as CustomRulesetDetail;
      })
      .then((data) => {
        if (cancelled) return;
        const formula =
          data.score_formula && 'type' in (data.score_formula as object)
            ? (data.score_formula as FormulaNode)
            : null;
        const isTfV1 = data.code === 'TF_v1';
        const tfCfg = data.tf_config ?? {};

        // For TF v1, the canonical store for match-format defaults and
        // double-penalty formula is `tf_config.*`. For custom rulesets it
        // lives in the dedicated sibling columns. The form treats both as
        // the same UI — we just hydrate from the right place per code.
        const matchFormatSource = isTfV1
          ? (tfCfg.matchFormat ?? null)
          : (data.match_format_defaults ?? null);
        const doublePenaltySource = isTfV1
          ? (tfCfg.doublePenaltyFormula ?? '')
          : (data.double_penalty_formula ?? '');

        const tfV1Internals: TfV1Internals = isTfV1
          ? {
              winBonus: tfCfg.winBonus ?? DEFAULT_TF_V1_INTERNALS.winBonus,
              deepTarget: tfCfg.targetValues?.deepTarget ?? DEFAULT_TF_V1_INTERNALS.deepTarget,
              shallowTarget:
                tfCfg.targetValues?.shallowTarget ?? DEFAULT_TF_V1_INTERNALS.shallowTarget,
            }
          : DEFAULT_TF_V1_INTERNALS;

        setInitial({
          code: data.code,
          name: data.name,
          description: data.description ?? '',
          version: data.version,
          scoreFormula: formula,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(data.constants ?? {}) },
          tiebreakers: data.tiebreakers ?? [],
          matchFormatDefaults: {
            ...DEFAULT_MATCH_FORMAT_DEFAULTS,
            ...(matchFormatSource ?? {}),
            timeLimitsSeconds: {
              ...DEFAULT_MATCH_FORMAT_DEFAULTS.timeLimitsSeconds,
              ...(matchFormatSource?.timeLimitsSeconds ?? {}),
            },
          },
          doublePenaltyFormula: doublePenaltySource,
          tfV1Internals,
          isSystem: data.is_system,
          systemRankingChain: data.systemRankingChain,
          systemMetadata: data.systemMetadata,
        });
        setCurrentVersion(data.version);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.rulesets.loadOneError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [id, t, loadVersions]);

  // The current draft is "frozen" when a tournament already references the
  // active (code, version) pair. The signal we have client-side is the
  // matching snapshot row in `versions` having is_frozen=true. We mirror the
  // server-side guard so the form disables and surfaces a banner without
  // waiting for the PATCH to round-trip.
  const isCurrentFrozen = Boolean(
    currentVersion && versions.find((v) => v.version === currentVersion && v.is_frozen),
  );

  async function handleRestore(snapshot: VersionSnapshot) {
    if (!id) return;
    const confirmed = window.confirm(
      t('admin.rulesets.versionRestoreConfirm').replace('{version}', snapshot.version),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/custom-rulesets/${id}/versions/${snapshot.id}/rollback`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
      }
      // Reload the form payload to reflect the restored draft.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
      setBusy(false);
    }
  }

  async function handlePublishNewVersion() {
    if (!id) return;
    const nextVersion = window.prompt(t('admin.rulesets.publishNewVersionPrompt'));
    // Empty string = auto-bump; null (cancel) = abort.
    if (nextVersion === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextVersion: nextVersion.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
      setBusy(false);
    }
  }

  return (
    <main className="grid max-w-6xl gap-6 p-8 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="mb-2 text-sm">
          <Link href="/admin/rulesets" className="text-slate-500 hover:underline">
            {t('admin.rulesets.backToList')}
          </Link>
        </div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('admin.rulesets.editTitle')}</h1>
        <p className="mb-6 text-sm text-slate-500">{t('admin.rulesets.editDescription')}</p>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading || !initial ? (
          <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
        ) : (
          <>
            {!initial.isSystem && isCurrentFrozen && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span>{t('admin.rulesets.versionFrozenBanner')}</span>
                <button
                  type="button"
                  onClick={handlePublishNewVersion}
                  disabled={busy}
                  className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {t('admin.rulesets.publishNewVersionAction')}
                </button>
              </div>
            )}
            <RulesetForm
              initial={initial}
              code={initial.code}
              disabled={isCurrentFrozen}
              busy={busy}
              // System metadata / ranking chain props intentionally dropped
              // so the TF v1 admin edit form renders with the same shape
              // as every other ruleset (no read-only "System ruleset
              // details" panel above the form). The component still
              // accepts these props; only the mount call no longer passes
              // them.
              submitLabel={t('admin.rulesets.saveAction')}
              onSubmit={async (data) => {
                setBusy(true);
                setError(null);
                try {
                  // For TF v1 the operator's edits land in `tf_config` —
                  // the back-end merges that over TFv1DefaultConfig at
                  // tournament creation. For custom rulesets we send the
                  // sibling columns as before.
                  const body =
                    initial.code === 'TF_v1'
                      ? {
                          name: data.name,
                          description: data.description,
                          version: data.version,
                          tfConfig: {
                            winBonus: data.tfV1Internals?.winBonus,
                            targetValues: {
                              deepTarget: data.tfV1Internals?.deepTarget,
                              shallowTarget: data.tfV1Internals?.shallowTarget,
                            },
                            matchFormat: data.matchFormatDefaults,
                            doublePenaltyFormula: data.doublePenaltyFormula || undefined,
                          },
                        }
                      : data;
                  const res = await fetch(`${apiUrl}/api/v1/admin/custom-rulesets/${id}`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                  if (!res.ok) {
                    const resp = (await res.json().catch(() => ({}))) as { message?: string };
                    throw new Error(resp.message ?? t('admin.rulesets.actionFailed'));
                  }
                  router.push('/admin/rulesets/scoring');
                } catch (err) {
                  setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
                  setBusy(false);
                }
              }}
              onCancel={() => router.push('/admin/rulesets/scoring')}
            />
          </>
        )}
      </div>

      {!loading && initial && !initial.isSystem && (
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              {t('admin.rulesets.versionHistoryTitle')}
            </h2>
            {versionsError && <p className="mb-2 text-xs text-red-600">{versionsError}</p>}
            {versions.length === 0 ? (
              <p className="text-xs text-slate-400">{t('admin.rulesets.versionHistoryEmpty')}</p>
            ) : (
              <ul className="space-y-3">
                {versions.map((snap) => (
                  <li
                    key={snap.id}
                    className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {snap.version}
                      </span>
                      {snap.is_frozen && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          {t('admin.rulesets.versionFrozenBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(snap.published_at).toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleRestore(snap)}
                      disabled={busy || snap.version === currentVersion}
                      className="mt-1 text-xs font-semibold text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                    >
                      {t('admin.rulesets.versionRestoreAction')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}
    </main>
  );
}
