'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DEFAULT_FORMULA_CONSTANTS,
  diffRulesetBuckets,
  projectRulesetBuckets,
} from '@myclash/rulesets';
import type {
  BucketDiff,
  DoublePenaltySpec,
  FormulaConstants,
  FormulaNode,
  RankingRule,
  RulesetMetadata,
  Target,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '../../../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  type MatchFormatDefaults,
  type RulesetFormValue,
} from '../../../../../../../src/components/rulesets/RulesetForm';
import {
  rulesetFormInitial,
  type RulesetRowLike,
} from '../../../../../../../src/components/rulesets/ruleset-form-initial';
import { ForkLineagePanel } from '../../../../../../../src/components/rulesets/LineageLamps';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface OrgCustomRulesetDetail {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  is_system: boolean;
  owner_organization_id: string | null;
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  tiebreakers: Tiebreaker[];
  match_format_defaults: Partial<MatchFormatDefaults> | null;
  double_penalty_formula: DoublePenaltySpec | null;
  targets: Target[] | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
  /** Set on a coded fork ("Customise this format"): the built-in it reuses. */
  base_code: string | null;
  /** Super-admin TF v1 overrides — the CANONICAL store for TF v1's
   *  match-format defaults + double-penalty formula. Omitting this field
   *  was the bug where the org view of TF v1 showed the generic 5/180
   *  fallbacks instead of the configured values. */
  tf_config: RulesetRowLike['tf_config'];
  submitted_for_review_at: string | null;
  rejected_reason: string | null;
  public_visibility: boolean;
  /** For is_system rows: the coded ranking chain + metadata (incl. the score
   *  formula), hydrated by the org list endpoint so the read-only "System
   *  ruleset details" panel renders for built-ins like TF v1. */
  systemRankingChain?: RankingRule[];
  systemMetadata?: RulesetMetadata;
}

/**
 * Edit an org-owned scoring ruleset. PATCH goes through the org-scoped
 * controller (which gates by org-admin + ownership). System rulesets
 * (TF v1, built-ins) open read-only — including TF v1's internals so
 * organisers see exactly what the super-admin configured.
 */
export default function OrgEditScoringRulesetPage() {
  const params = useParams<{ slug: string; id: string }>();
  const slugForLink = params.slug ?? '';
  const router = useRouter();
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<
    | (RulesetFormValue & {
        code: string;
        systemRankingChain?: RankingRule[];
        systemMetadata?: RulesetMetadata;
      })
    | null
  >(null);
  const [submissionBanner, setSubmissionBanner] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  // A coded fork reuses a built-in's algorithm; it has no formula to edit here,
  // so we show a read-only panel instead of the (empty) authoring form. Holds
  // the base's human name when this row is a fork, plus the per-bucket diff.
  const [forkOf, setForkOf] = useState<string | null>(null);
  const [forkDiff, setForkDiff] = useState<BucketDiff | null>(null);

  // Resolve org id once.
  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    void fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`, {
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

  // Fetch the row from the org catalog (system + public + own) and find it by
  // id. The owner-gated detail endpoint can't return built-ins/shared rows, so
  // the list is the only org-visible source — which also lets us open those
  // read-only as a "View".
  useEffect(() => {
    if (!orgId || !params.id) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('admin.rulesets.loadOneError'));
        return (await res.json()) as OrgCustomRulesetDetail[];
      })
      .then((rows) => {
        if (cancelled) return;
        const data = rows.find((r) => r.id === params.id);
        if (!data) throw new Error(t('admin.rulesets.loadOneError'));
        if (data.base_code) {
          const baseRow = rows.find((r) => r.code === data.base_code);
          setForkOf(baseRow?.name ?? data.base_code);
          if (baseRow)
            setForkDiff(
              diffRulesetBuckets(projectRulesetBuckets(baseRow), projectRulesetBuckets(data)),
            );
          return;
        }
        const formula =
          data.score_formula && 'type' in (data.score_formula as object)
            ? (data.score_formula as FormulaNode)
            : null;
        setInitial({
          code: data.code,
          name: data.name,
          description: data.description ?? '',
          version: data.version,
          scoreFormula: formula,
          constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(data.constants ?? {}) },
          tiebreakers: data.tiebreakers ?? [],
          // Same hydration as the super-admin page: TF v1 reads
          // tf_config.*, custom rulesets read the flat columns.
          ...rulesetFormInitial(data),
          systemRankingChain: data.systemRankingChain,
          systemMetadata: data.systemMetadata,
        });
        // Built-in or another org's shared ruleset → view-only (opened via the
        // list "View" action). The organiser can Clone it to get an editable
        // copy. Pending-review / already-public own rows are also read-only.
        if (data.is_system || data.owner_organization_id !== orgId) {
          setSubmissionBanner(t('admin.rulesets.viewOnlyBanner'));
          setReadOnly(true);
        } else if (data.submitted_for_review_at) {
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
        <Link href={`/org/${slugForLink}/rulesets/scoring`} className="text-muted hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.rulesets.editTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.rulesets.editDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {submissionBanner && (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            readOnly
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {submissionBanner}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : forkOf ? (
        <ForkLineagePanel base={forkOf} diff={forkDiff} />
      ) : !initial ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <RulesetForm
          initial={initial}
          validateUrl={
            orgId ? `${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/validate` : undefined
          }
          code={initial.code}
          tfInternalsTitle={t('admin.rulesets.tfV1InternalsTitleOrg')}
          disabled={readOnly}
          busy={busy}
          // Read-only system ruleset details (score formula + tie-breakers) for
          // built-ins like TF v1, hydrated by the org list endpoint.
          systemMetadata={initial.systemMetadata}
          systemRankingChain={initial.systemRankingChain}
          submitLabel={t('admin.rulesets.saveAction')}
          onSubmit={(data) =>
            void (async () => {
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
                router.push(`/org/${slugForLink}/rulesets/scoring`);
              } catch (err) {
                setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
                setBusy(false);
              }
            })()
          }
          onCancel={() => router.push(`/org/${slugForLink}/rulesets/scoring`)}
        />
      )}
    </main>
  );
}
