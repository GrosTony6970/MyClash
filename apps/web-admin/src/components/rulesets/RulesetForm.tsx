'use client';

import { useState } from 'react';
import type {
  FormulaConfig,
  FormulaConstants,
  FormulaNode,
  RankingRule,
  RulesetMetadata,
  Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';
import { FormulaEditor } from './FormulaEditor';
import { TiebreakersEditor } from './TiebreakersEditor';

export interface RulesetFormValue {
  name: string;
  description: string;
  version: string;
  scoreFormula: FormulaNode | null;
  constants: FormulaConstants;
  tiebreakers: Tiebreaker[];
}

interface Props {
  initial: RulesetFormValue;
  disabled?: boolean;
  busy?: boolean;
  submitLabel: string;
  /** Optional read-only metadata for is_system rulesets — sourced from the
   *  coded ruleset registry via the API. When provided, a System ruleset
   *  details panel renders above the form and the TiebreakersEditor's
   *  "no tie-breakers" fallback is replaced by a read-only list. */
  systemMetadata?: RulesetMetadata;
  systemRankingChain?: RankingRule[];
  onSubmit: (
    config: { name: string; description: string; version: string } & FormulaConfig,
  ) => void;
  onCancel?: () => void;
}

export function RulesetForm({
  initial,
  disabled,
  busy,
  submitLabel,
  systemMetadata,
  systemRankingChain,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [version, setVersion] = useState(initial.version);
  const [scoreFormula, setScoreFormula] = useState<FormulaNode | null>(initial.scoreFormula);
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [constants, setConstants] = useState<FormulaConstants>(initial.constants);
  const [tiebreakers, setTiebreakers] = useState<Tiebreaker[]>(initial.tiebreakers);
  const [validationError, setValidationError] = useState<string | null>(null);

  function setConstant(key: keyof FormulaConstants, value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setConstants((c) => ({ ...c, [key]: n }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (!name.trim()) {
      setValidationError(t('admin.rulesets.nameRequired'));
      return;
    }
    if (!scoreFormula) {
      setValidationError(formulaError ?? t('admin.rulesets.formulaInvalid'));
      return;
    }
    setValidationError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      version: version.trim() || '1.0.0',
      scoreFormula,
      constants,
      tiebreakers,
    });
  }

  const showSystemPanel = !!systemMetadata || (systemRankingChain && systemRankingChain.length > 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {validationError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {validationError}
        </div>
      )}

      {showSystemPanel && (
        <SystemRulesetPanel
          metadata={systemMetadata ?? {}}
          rankingChain={systemRankingChain ?? []}
        />
      )}

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            {t('admin.rulesets.nameLabel')}
            <input
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            {t('admin.rulesets.versionLabel')}
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={disabled}
              placeholder="1.0.0"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold text-slate-700">
          {t('admin.rulesets.descriptionLabel')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
        </label>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.rulesets.constantsTitle')}
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(['pointsPerVictory', 'pointsPerTie', 'pointsPerLoss', 'doublePenalty'] as const).map(
            (key) => (
              <label key={key} className="block text-xs font-semibold text-slate-700">
                {t(`admin.rulesets.variables.${key}`)}
                <input
                  type="number"
                  step="0.01"
                  value={constants[key]}
                  onChange={(e) => setConstant(key, e.target.value)}
                  disabled={disabled}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
                />
              </label>
            ),
          )}
        </div>
        <ScorePreviewChip constants={constants} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.rulesets.formulaTitle')}
        </h3>
        <p className="mb-2 text-xs text-slate-500">{t('admin.rulesets.formulaHelp')}</p>
        <FormulaEditor
          value={scoreFormula}
          onChange={(ast, err) => {
            setScoreFormula(ast);
            setFormulaError(err);
          }}
          disabled={disabled}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.rulesets.tiebreakersTitle')}
        </h3>
        <p className="mb-2 text-xs text-slate-500">{t('admin.rulesets.tiebreakersHelp')}</p>
        <TiebreakersEditor
          value={tiebreakers}
          onChange={setTiebreakers}
          disabled={disabled}
          systemFallback={systemRankingChain}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || busy}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {busy ? t('admin.rulesets.saving') : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('admin.rulesets.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── System ruleset details panel ─────────────────────────────────────────────

function SystemRulesetPanel({
  metadata,
  rankingChain,
}: {
  metadata: RulesetMetadata;
  rankingChain: RankingRule[];
}) {
  const { t } = useI18n();

  function formatRankingKey(key: string): string {
    // Soft i18n: known keys get a translated label; anything else falls back
    // to the raw key (camelCase looks readable enough).
    const i18nKey = `admin.rulesets.rankingKey_${key}`;
    const translated = t(i18nKey);
    return translated === i18nKey ? key : translated;
  }

  function formatDirection(direction: 'asc' | 'desc'): string {
    return direction === 'desc'
      ? t('admin.rulesets.systemPanelDirectionHighest')
      : t('admin.rulesets.systemPanelDirectionLowest');
  }

  function formatYesNo(value: boolean | null | undefined): string {
    if (value === true) return t('admin.rulesets.systemPanelTrue');
    if (value === false) return t('admin.rulesets.systemPanelFalse');
    return '—';
  }

  function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : String(value);
  }

  function formatString(value: string | null | undefined): string {
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-600">
          {t('admin.rulesets.systemPanelTitle')}
        </h3>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          {t('admin.rulesets.systemPanelReadOnlyBadge')}
        </span>
      </div>

      <dl className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <MetadataField
          label={t('admin.rulesets.systemPanelHasAfterblow')}
          value={formatYesNo(metadata.hasAfterblow)}
        />
        <MetadataField
          label={t('admin.rulesets.systemPanelWinBonus')}
          value={formatNumber(metadata.winBonus)}
        />
        <MetadataField
          label={t('admin.rulesets.systemPanelDeepTarget')}
          value={formatNumber(metadata.deepTargetDefault)}
        />
        <MetadataField
          label={t('admin.rulesets.systemPanelShallowTarget')}
          value={formatNumber(metadata.shallowTargetDefault)}
        />
        <MetadataField
          label={t('admin.rulesets.systemPanelDoublePenalty')}
          value={formatString(metadata.doublePenaltyFormula)}
        />
      </dl>

      {rankingChain.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {t('admin.rulesets.systemPanelTiebreakers')}
          </p>
          <ol className="space-y-1 text-sm text-slate-800">
            {rankingChain.map((rule, idx) => (
              <li
                key={`${rule.key}-${idx}`}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                <span className="w-6 font-mono text-xs text-slate-500">{idx + 1}.</span>
                <span className="font-medium">{formatRankingKey(rule.key)}</span>
                <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {formatDirection(rule.direction)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function MetadataField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-slate-800">{value}</dd>
    </div>
  );
}

// ── Score preview chip ───────────────────────────────────────────────────────
// Quick "what would a hypothetical fighter score" reference using the standard
// points-per-result + doublePenalty constants. Doesn't try to evaluate the
// full custom AST (that would require carrying the formula evaluator into the
// admin bundle); the chip stays useful by showing the most common shape:
//   3 wins, 1 tie, 1 loss, 1 double-hit
// score = 3 * pPV + 1 * pPT + 1 * pPL - 1 * doublePenalty
function ScorePreviewChip({ constants }: { constants: FormulaConstants }) {
  const wins = 3;
  const ties = 1;
  const losses = 1;
  const doubles = 1;
  const score =
    wins * constants.pointsPerVictory +
    ties * constants.pointsPerTie +
    losses * constants.pointsPerLoss -
    doubles * constants.doublePenalty;
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Preview</span>
      <span>
        {wins}W + {ties}T + {losses}L − {doubles} double ={' '}
        <span className="font-mono font-semibold text-slate-900">{score.toFixed(2)}</span> pts
      </span>
    </div>
  );
}
