'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import type { FormulaConstants, FormulaNode, Tiebreaker } from '@myclash/rulesets';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
  DEFAULT_TF_V1_INTERNALS,
  type MatchFormatDefaults,
  type RulesetFormValue,
} from '../../../../../../../src/components/rulesets/RulesetForm';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface OrgCustomRulesetDetail {
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
  submitted_for_review_at: string | null;
  rejected_reason: string | null;
  public_visibility: boolean;
}

/**
 * Edit an org-owned scoring ruleset. PATCH goes through the org-scoped
 * controller (which gates by org-admin + ownership). For deep-form
 * features (version history, TF v1 internals) we don't expose them on
 * the org page — those are super-admin concerns on system rulesets.
 */
export default function OrgEditScoringRulesetPage() {
  const params = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<RulesetFormValue | null>(null);
  const [submissionBanner, setSubmissionBanner] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  // Resolve org id once.
  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((org: { id?: string } | null) => {
        if (!cancelled && org?.id) setOrgId(org.id);
      });
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  // Fetch the row once we have orgId.
  useEffect(() => {
    if (!orgId || !params.id) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/${params.id}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.loadOneError'));
        return (await res.json()) as OrgCustomRulesetDetail;
      })
      .then((data) => {
        if (cancelled) return;
        const formula =
          data.score_formula && 'type' in (data.score_formula as object)
            ? (data.score_formula as FormulaNode)
            : null;
        setInitial({
          name: data.name,
          description: data.description ?? '',
          version: data.version,
          scoreFormula: formula,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(data.constants ?? {}) },
          tiebreakers: data.tiebreakers ?? [],
          matchFormatDefaults: {
            ...DEFAULT_MATCH_FORMAT_DEFAULTS,
            ...(data.match_format_defaults ?? {}),
            timeLimitsSeconds: {
              ...DEFAULT_MATCH_FORMAT_DEFAULTS.timeLimitsSeconds,
              ...(data.match_format_defaults?.timeLimitsSeconds ?? {}),
            },
          },
          doublePenaltyFormula: data.double_penalty_formula ?? '',
          tfV1Internals: DEFAULT_TF_V1_INTERNALS,
        });
        // A row that's pending review or already public is treated as
        // read-only — the organiser can't tweak it mid-flight. Withdraw
        // (R3) or wait for the super-admin to reject (so the org can fix
        // and resubmit) before editing.
        if (data.submitted_for_review_at) {
          setSubmissionBanner(t('admin.rulesets.submissionPendingBanner'));
          setReadOnly(true);
        } else if (data.public_visibility) {
          setSubmissionBanner(t('admin.rulesets.submissionApprovedBanner'));
          setReadOnly(true);
        } else if (data.rejected_reason) {
          setSubmissionBanner(
            `${t('admin.rulesets.submissionRejectedBanner')}: ${data.rejected_reason}`,
          );
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('admin.rulesets.loadOneError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, params.id, t]);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link
          href={`/org/${params.slug}/rulesets/scoring`}
          className="text-slate-500 hover:underline"
        >
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

      {submissionBanner && (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            readOnly
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {submissionBanner}
        </div>
      )}

      {loading || !initial ? (
        <p className="text-sm text-slate-400">{t('admin.rulesets.loading')}</p>
      ) : (
        <RulesetForm
          initial={initial}
          disabled={readOnly}
          busy={busy}
          submitLabel={t('admin.rulesets.saveAction')}
          onSubmit={async (data) => {
            if (!orgId) return;
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(
                `${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/${params.id}`,
                {
                  method: 'PATCH',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                },
              );
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { message?: string };
                throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
              }
              router.push(`/org/${params.slug}/rulesets/scoring`);
            } catch (err) {
              setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
              setBusy(false);
            }
          }}
          onCancel={() => router.push(`/org/${params.slug}/rulesets/scoring`)}
        />
      )}
    </main>
  );
}
