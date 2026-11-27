'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_FORMULA_CONSTANTS, DEFAULT_TARGETS, tfV1AsFormula } from '@myclash/rulesets';
import type {
  DoublePenaltySpec,
  FormulaConstants,
  FormulaNode,
  Target,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import {
  RulesetForm,
  type RulesetFormValue,
} from '../../../../../../src/components/rulesets/RulesetForm';
import {
  rulesetFormInitial,
  type RulesetRowLike,
} from '../../../../../../src/components/rulesets/ruleset-form-initial';
import { DEFAULT_AFTERBLOW_GRAMMAR } from '../../../../../../src/components/rulesets/AfterblowGrammarEditor';
import { rulesetEditorKind } from '../../../../../../src/components/rulesets/ruleset-kind';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

const apiUrl = getPublicApiUrl();

const BLANK_INITIAL: RulesetFormValue = {
  name: '',
  description: '',
  version: '1.0.0',
  scoreFormula: null,
  constants: { ...DEFAULT_FORMULA_CONSTANTS, pointsPerVictory: 3 },
  tiebreakers: [{ variable: 'victories', direction: 'desc' }],
  // Nothing of its own: every match format field follows the engine (ruling 59).
  ownMatchFormat: {},
  ownCoded: {},
  doublePenaltyFormula: null,
  targets: [...DEFAULT_TARGETS],
  afterblow: DEFAULT_AFTERBLOW_GRAMMAR,
};

/** Row shape (subset) returned by the org catalog list — carries the full
 *  config for system / public / owned rulesets, so it doubles as the clone
 *  source (the owner-gated detail endpoint can't return built-ins). */
interface OrgRulesetCatalogRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  is_system: boolean;
  score_formula: FormulaNode | Record<string, never>;
  constants: Partial<FormulaConstants> | null;
  /** `NOT NULL DEFAULT '[]'` (0038): a built-in's is empty, its ranking is code. */
  tiebreakers: Tiebreaker[];
  match_format_defaults: RulesetRowLike['match_format_defaults'];
  double_penalty_formula: DoublePenaltySpec | null;
  targets: Target[] | null;
  has_afterblow: boolean | null;
  afterblow_mode: 'full' | 'deductive' | null;
  afterblow_valuation: 'fixed' | 'weighted' | null;
  afterblow_fixed_value: number | null;
  /** Set on a coded fork of TF v1: a copy of it is a copy of TF v1. */
  base_code: string | null;
  /** TF v1's canonical store of its own values — without it a TF v1 clone
   *  would silently lose them. */
  tf_config: RulesetRowLike['tf_config'];
}

/**
 * A copy of TF v1 (the built-in, or a club's coded copy of it) is a formula
 * ruleset the club can edit freely, starting from TF v1 written as a formula
 * (ruling 2026-11-27). It scores exactly as TF v1 until edited:
 * `tf_v1.as-formula.parity.test.ts`. Its match format is its source's own.
 */
function tfCopyInitial(row: OrgRulesetCatalogRow): RulesetFormValue {
  const { formula, grammar } = tfV1AsFormula(row.tf_config);
  return {
    name: `${row.name} (copy)`,
    description: row.description ?? '',
    version: '1.0.0',
    scoreFormula: formula.scoreFormula,
    constants: formula.constants,
    tiebreakers: formula.tiebreakers,
    ownMatchFormat: rulesetFormInitial(row).ownMatchFormat,
    ownCoded: {},
    doublePenaltyFormula: formula.doublePenaltyFormula,
    targets: grammar.targets,
    afterblow: {
      hasAfterblow: grammar.hasAfterblow,
      afterblowValuation: grammar.afterblowValuation,
      afterblowFixedValue: grammar.afterblowFixedValue,
      afterblowMode: grammar.defaultAfterblowMode,
    },
  };
}

/** Build a fresh-create form value from a ruleset being cloned: copy the
 *  config, append "(copy)" to the name, reset the version. */
function cloneInitial(row: OrgRulesetCatalogRow): RulesetFormValue {
  if (rulesetEditorKind(row.code, row.base_code) === 'tf') return tfCopyInitial(row);
  const formula =
    row.score_formula && 'type' in (row.score_formula as object)
      ? (row.score_formula as FormulaNode)
      : null;
  // The source's own values come from the same shared hydration the edit
  // pages use, so a copy carries what its source set and nothing filled in.
  const { ownMatchFormat, ownCoded, doublePenaltyFormula, targets, afterblow } =
    rulesetFormInitial(row);
  return {
    name: `${row.name} (copy)`,
    description: row.description ?? '',
    version: '1.0.0',
    scoreFormula: formula,
    constants: { ...DEFAULT_FORMULA_CONSTANTS, ...(row.constants ?? {}) },
    // A built-in's row holds no tie-breakers of its own (its ranking is code): a copy of Points
    // cap starts from a blank create's.
    tiebreakers: row.is_system ? BLANK_INITIAL.tiebreakers : row.tiebreakers,
    ownMatchFormat,
    ownCoded,
    doublePenaltyFormula,
    targets,
    afterblow,
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

  // Without the org id nothing on this page can be saved — `busy={busy || !orgId}`
  // keeps the submit disabled — so a refused resolve has to be said out loud.
  // It used to be swallowed, which left a form that could not be submitted and
  // (with `?cloneFrom=`) a "Loading…" that never ended.
  useEffect(() => {
    if (!params.slug) return;
    let cancelled = false;
    void apiRequest<{ id: string }>(
      apiUrl,
      `/api/v1/organizations/slug/${encodeURIComponent(params.slug)}`,
    ).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setOrgId(r.data.id);
        return;
      }
      const message = failureMessage(r, t, t('admin.rulesets.curatedLoadError'));
      if (message) setError(message);
      setCloneLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [params.slug, t]);

  // Load the clone source from the org catalog (includes system + public + own).
  useEffect(() => {
    if (!orgId || !cloneFrom) return;
    let cancelled = false;
    void apiRequest<OrgRulesetCatalogRow[]>(
      apiUrl,
      `/api/v1/organizations/${orgId}/custom-rulesets`,
    )
      .then((r) => {
        // A catalog that will not load leaves a blank create form, which is
        // still usable — same silence as before.
        if (cancelled || !r.ok) return;
        const src = r.data.find((row) => row.id === cloneFrom);
        if (!src) return;
        // A TF v1 source whose stored settings do not parse cannot be copied:
        // say so, and leave the blank form.
        try {
          setInitial(cloneInitial(src));
        } catch {
          setError(t('admin.rulesets.cloneSourceUnreadable'));
        }
      })
      .finally(() => {
        if (!cancelled) setCloneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, cloneFrom, t]);

  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <BackLink
        href={`/org/${slugForLink}/rulesets/scoring`}
        label={t('admin.rulesets.backToList')}
        className="mb-2"
      />
      <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('admin.rulesets.createTitle')}
      </h1>
      <p className="mb-6 text-sm text-muted">{t('admin.rulesets.createDescriptionOrg')}</p>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {cloneLoading ? (
        <p className="text-sm text-muted">{t('admin.rulesets.loading')}</p>
      ) : (
        <>
          <RulesetForm
            initial={initial}
            validateUrl={
              orgId ? `${apiUrl}/api/v1/organizations/${orgId}/custom-rulesets/validate` : undefined
            }
            // Every copy is a formula ruleset: of Points cap (ruling 133), and
            // of TF v1 (ruling 2026-11-27). `code` stays unset — the new row's
            // code is generated server-side.
            busy={busy || !orgId}
            submitLabel={t('admin.rulesets.createButton')}
            onSubmit={(data) =>
              void (async () => {
                if (!orgId) return;
                setBusy(true);
                setError(null);
                const r = await apiRequest<{ id: string }>(
                  apiUrl,
                  `/api/v1/organizations/${orgId}/custom-rulesets`,
                  { method: 'POST', body: data },
                );
                if (!r.ok) {
                  const message = failureMessage(r, t, t('admin.rulesets.actionFailed'));
                  if (message) setError(message);
                  setBusy(false);
                  return;
                }
                router.push(`/org/${slugForLink}/rulesets/scoring/${r.data.id}/edit`);
              })()
            }
            onCancel={() => router.push(`/org/${slugForLink}/rulesets/scoring`)}
          />
        </>
      )}
    </main>
  );
}
