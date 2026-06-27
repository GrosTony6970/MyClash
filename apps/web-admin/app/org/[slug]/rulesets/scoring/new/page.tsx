'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS } from '@myclash/rulesets';
import type { FormulaConstants, FormulaNode, Tiebreaker } from '@myclash/rulesets';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import {
  RulesetForm,
  DEFAULT_MATCH_FORMAT_DEFAULTS,
  type MatchFormatDefaults,
  type RulesetFormValue,
} from '../../../../../../src/components/rulesets/RulesetForm';
import {
  rulesetFormInitial,
  type RulesetRowLike,
} from '../../../../../../src/components/rulesets/ruleset-form-initial';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

const BLANK_INITIAL: RulesetFormValue = {
  name: '',
  description: '',
  version: '1.0.0',
  scoreFormula: null,
  constants: { ...DEFAULT_FORMULA_CONSTANTS, pointsPerVictory: 3 },
  tiebreakers: [{ variable: 'victories', direction: 'desc' }],
  matchFormatDefaults: DEFAULT_MATCH_FORMAT_DEFAULTS,
  doublePenaltyFormula: '',
};

/** Row shape (subset) returned by the org catalog list — carries the full
 *  config for system / public / owned rulesets, so it doubles as the clone
 *  source (the owner-gated detail endpoint can't return built-ins). */
interface OrgRulesetCatalogRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  tiebreakers: Tiebreaker[] | null;
  match_format_defaults: Partial<MatchFormatDefaults> | null;
  double_penalty_formula: string | null;
  /** TF v1's canonical match-format store — without it a TF v1 clone
   *  would silently seed from the generic 5/180 defaults. */
  tf_config: RulesetRowLike['tf_config'];
}

/** Build a fresh-create form value from a ruleset being cloned: copy the
 *  config, append "(copy)" to the name, reset the version. */
function cloneInitial(row: OrgRulesetCatalogRow): RulesetFormValue {
  const formula =
    row.score_formula && 'type' in (row.score_formula as object)
      ? (row.score_formula as FormulaNode)
      : null;
  // Match-format defaults + double-penalty come from the same shared
  // hydration the edit pages use, so cloning TF v1 carries its real
  // configured values (tf_config.matchFormat), not the generic fallbacks.
  const { matchFormatDefaults, doublePenaltyFormula } = rulesetFormInitial(row);
  return {
    name: `${row.name} (copy)`,
    description: row.description ?? '',
    version: '1.0.0',
    scoreFormula: formula,
    constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(row.constants ?? {}) },
    tiebreakers: row.tiebreakers ?? BLANK_INITIAL.tiebreakers,
    matchFormatDefaults,
    doublePenaltyFormula,
  };
}

/**
 * Organizer-side "create scoring ruleset" page. POSTs to the org-scoped
 * endpoint so the row is created with `owner_organization_id` set and is
 * immediately usable on the org's tournaments. With `?cloneFrom=<id>` the
 * form is pre-filled from that ruleset (built-in, shared, or own) so the
 * organizer can save an editable copy.
 */
export default function OrgNewScoringRulesetPage() {
  const params = useParams<{ slug: string }>();
  const slugForLink = params.slug ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [initial, setInitial] = useState<RulesetFormValue>(BLANK_INITIAL);
  // Wait for the clone source before rendering the form so RulesetForm seeds
  // from the cloned values (it reads `initial` once, on mount).
  const [cloneLoading, setCloneLoading] = useState<boolean>(Boolean(cloneFrom));

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

  // Load the clone source from the org catalog (includes system + public + own).
  useEffect(() => {
    if (!orgId || !cloneFrom) return;
    let cancelled = false;
    void fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: OrgRulesetCatalogRow[]) => {
        if (cancelled) return;
        const src = rows.find((r) => r.id === cloneFrom);
        if (src) setInitial(cloneInitial(src));
      })
      .finally(() => {
        if (!cancelled) setCloneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, cloneFrom]);

  return (
    <main className="max-w-4xl p-8">
      <div className="mb-2 text-sm">
        <Link href={`/org/${slugForLink}/rulesets/scoring`} className="text-muted hover:underline">
          {t('admin.rulesets.backToList')}
        </Link>
      </div>
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.rulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.rulesets.createDescription')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {cloneLoading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <RulesetForm
          initial={initial}
          busy={busy || !orgId}
          submitLabel={t('admin.rulesets.createButton')}
          onSubmit={async (data) => {
            if (!orgId) return;
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { message?: string };
                throw new Error(body.message ?? t('admin.rulesets.actionFailed'));
              }
              const created = (await res.json()) as { id: string };
              router.push(`/org/${slugForLink}/rulesets/scoring/${created.id}/edit`);
            } catch (err) {
              setError(err instanceof Error ? err.message : t('admin.rulesets.actionFailed'));
              setBusy(false);
            }
          }}
          onCancel={() => router.push(`/org/${slugForLink}/rulesets/scoring`)}
        />
      )}
    </main>
  );
}
