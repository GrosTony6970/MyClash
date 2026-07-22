'use client';

import { useState } from 'react';
import {
  DEFAULT_TARGETS,
  type FormulaConfig,
  type FormulaConstants,
  type FormulaNode,
  type RankingRule,
  type RulesetMetadata,
  type DoublePenaltySpec,
  type Target,
  type Tiebreaker,
} from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';
import { RulesetPreviewPanel } from './RulesetPreviewPanel';
import { FormulaEditor } from './FormulaEditor';
import { TargetsEditor } from './TargetsEditor';
import { DoublePenaltyEditor } from './DoublePenaltyEditor';
import {
  AfterblowGrammarEditor,
  DEFAULT_AFTERBLOW_GRAMMAR,
  type AfterblowGrammar,
} from './AfterblowGrammarEditor';
import { TiebreakersEditor } from './TiebreakersEditor';
import { isCodedRuleset } from './ruleset-kind';

export interface MatchFormatDefaults {
  pointCap: number;
  timerMode: 'countdown' | 'countup';
  timeLimitsSeconds: { pool: number | null; bracket: number | null; finals: number | null };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  scoringDirection: 'normal' | 'reverse_zero_loses';
}

export const DEFAULT_MATCH_FORMAT_DEFAULTS: MatchFormatDefaults = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 180, finals: 180 },
  softClockLimitSeconds: 0,
  maxDoubleHits: null,
  scoringDirection: 'normal',
};

/**
 * TF v1 internals — the TFv1ConfigSchema-shaped values a super-admin can
 * tune on the system ruleset (Round 7). Stored in the parent row's
 * `tf_config` JSONB column; merged by resolveRulesetConfigDefaults over
 * TFv1DefaultConfig so a new tournament inherits these values.
 */
export interface TfV1Internals {
  winBonus: number;
  deepTarget: number;
  shallowTarget: number;
}

export const DEFAULT_TF_V1_INTERNALS: TfV1Internals = {
  winBonus: 3,
  deepTarget: 2,
  shallowTarget: 1,
};

export interface RulesetFormValue {
  name: string;
  description: string;
  version: string;
  scoreFormula: FormulaNode | null;
  constants: FormulaConstants;
  tiebreakers: Tiebreaker[];
  matchFormatDefaults: MatchFormatDefaults;
  doublePenaltyFormula: DoublePenaltySpec | null;
  /** Named targets — the grammar half of the ruleset, authorable for every
   *  ruleset. For TF_v1 the caller also mirrors the first two into
   *  tf_config.targetValues so today's scoring is unchanged. */
  targets: Target[];
  /** Whether the ruleset uses afterblow and how a retaliation is valued. */
  afterblow: AfterblowGrammar;
  /** Populated for TF_v1 rows (Round 7). Ignored for custom rulesets. */
  tfV1Internals?: TfV1Internals;
}

interface Props {
  initial: RulesetFormValue;
  disabled?: boolean;
  busy?: boolean;
  /** When set, a live server-side score preview replaces the constants-only
   *  chip (the formula evaluator stays out of the admin bundle). */
  validateUrl?: string;
  submitLabel: string;
  /** Ruleset code — when 'TF_v1', the form renders the TF v1 internals
   * section and the onSubmit payload carries `tfV1Internals`. */
  code?: string;
  /** Set on a coded fork ("Customise this format"): the built-in coded engine
   *  it reuses. When it (or `code`) is 'TF_v1' the form renders the coded
   *  internals instead of the formula editor — so an editable fork opens in the
   *  right editor, not an empty formula. */
  baseCode?: string | null;
  /** Override for the TF v1 internals section title. The default carries
   *  a "(SUPER-ADMIN)" suffix; the org read-only view passes a neutral
   *  title instead. */
  tfInternalsTitle?: string;
  /** Optional read-only metadata for is_system rulesets — sourced from the
   *  coded ruleset registry via the API. When provided, a System ruleset
   *  details panel renders above the form and the TiebreakersEditor's
   *  "no tie-breakers" fallback is replaced by a read-only list. */
  systemMetadata?: RulesetMetadata;
  systemRankingChain?: RankingRule[];
  onSubmit: (
    config: { name: string; description: string; version: string } & FormulaConfig & {
        matchFormatDefaults: MatchFormatDefaults;
        doublePenaltyFormula: DoublePenaltySpec | null;
        targets: Target[];
        tfV1Internals?: TfV1Internals;
      } & AfterblowGrammar,
  ) => void;
  onCancel?: () => void;
}

export function RulesetForm({
  initial,
  disabled,
  busy,
  validateUrl,
  submitLabel,
  code,
  baseCode,
  tfInternalsTitle,
  systemMetadata,
  systemRankingChain,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const isCoded = isCodedRuleset(code, baseCode);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [version, setVersion] = useState(initial.version);
  const [scoreFormula, setScoreFormula] = useState<FormulaNode | null>(initial.scoreFormula);
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [constants, setConstants] = useState<FormulaConstants>(initial.constants);
  const [tiebreakers, setTiebreakers] = useState<Tiebreaker[]>(initial.tiebreakers);
  const [matchFormatDefaults, setMatchFormatDefaults] = useState<MatchFormatDefaults>(
    initial.matchFormatDefaults,
  );
  const [doublePenaltyFormula, setDoublePenaltyFormula] = useState<DoublePenaltySpec | null>(
    initial.doublePenaltyFormula,
  );
  const [tfV1Internals, setTfV1Internals] = useState<TfV1Internals>(
    initial.tfV1Internals ?? DEFAULT_TF_V1_INTERNALS,
  );
  const [targets, setTargets] = useState<Target[]>(
    initial.targets.length > 0 ? initial.targets : [...DEFAULT_TARGETS],
  );
  const [afterblow, setAfterblow] = useState<AfterblowGrammar>(
    initial.afterblow ?? DEFAULT_AFTERBLOW_GRAMMAR,
  );
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
    // TF v1 has no editable score-formula AST (the scoring algorithm is in
    // code, not data). Skip the formula validity check for that path.
    if (!isCoded && !scoreFormula) {
      setValidationError(formulaError ?? t('admin.rulesets.formulaInvalid'));
      return;
    }
    setValidationError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      version: version.trim() || '1.0.0',
      // For TF v1 the score formula is a code-level constant; the parent row
      // stores an empty placeholder. Pass it through unchanged so the API
      // doesn't choke on the validation pipeline.
      scoreFormula: (scoreFormula ?? ({} as FormulaNode)) as FormulaNode,
      constants,
      tiebreakers,
      matchFormatDefaults,
      doublePenaltyFormula,
      targets,
      // AfterblowGrammar's keys are exactly the API's grammar fields, so a
      // flat spread lands them where grammarColumns() reads them.
      ...afterblow,
      ...(isCoded ? { tfV1Internals } : {}),
    });
  }

  const showSystemPanel = !!systemMetadata || (systemRankingChain && systemRankingChain.length > 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {validationError && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {validationError}
        </div>
      )}

      {showSystemPanel && (
        <SystemRulesetPanel
          metadata={systemMetadata ?? {}}
          rankingChain={systemRankingChain ?? []}
        />
      )}

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-semibold text-foreground-secondary">
            {t('admin.rulesets.nameLabel')}
            <input
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground-secondary">
            {t('admin.rulesets.versionLabel')}
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={disabled}
              placeholder="1.0.0"
              className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm disabled:bg-background"
            />
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold text-foreground-secondary">
          {t('admin.rulesets.descriptionLabel')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
          />
        </label>
      </div>

      {isCoded && (
        <div className="rounded-md border border-purple-200 bg-purple-50/40 p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-purple-700">
            {tfInternalsTitle ?? t('admin.rulesets.tfV1InternalsTitle')}
          </h3>
          <p className="mb-3 text-xs text-foreground-secondary">
            {t('admin.rulesets.tfV1InternalsHelp')}
          </p>
          {/* Deep/shallow are no longer edited here — they moved to the Targets
              editor below, which is authorable for every ruleset. winBonus
              stays, as a ranking (not grammar) input. */}
          <div className="grid gap-3 md:grid-cols-3">
            <NumberInput
              label={t('admin.rulesets.tfV1WinBonus')}
              value={tfV1Internals.winBonus}
              disabled={disabled}
              min={0}
              max={20}
              onChange={(n) => setTfV1Internals({ ...tfV1Internals, winBonus: n })}
            />
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.rulesets.targetsTitle')}
        </h3>
        <p className="mb-3 text-xs text-muted">{t('admin.rulesets.targetsHelp')}</p>
        <TargetsEditor value={targets} onChange={setTargets} disabled={disabled} />
      </div>

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.rulesets.afterblowTitle')}
        </h3>
        <p className="mb-3 text-xs text-muted">{t('admin.rulesets.afterblowHelp')}</p>
        <AfterblowGrammarEditor
          value={afterblow}
          onChange={setAfterblow}
          // TF_v1's afterblow is the federation's, defined in code — shown here
          // read-only rather than as an editable no-op.
          disabled={disabled || isCoded}
        />
      </div>

      {!isCoded && (
        <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.constantsTitle')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {(['pointsPerVictory', 'pointsPerTie', 'pointsPerLoss', 'doublePenalty'] as const).map(
              (key) => (
                <label key={key} className="block text-xs font-semibold text-foreground-secondary">
                  {t(`admin.rulesets.variables.${key}`)}
                  <input
                    type="number"
                    step="0.01"
                    value={constants[key]}
                    onChange={(e) => setConstant(key, e.target.value)}
                    disabled={disabled}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm disabled:bg-background"
                  />
                </label>
              ),
            )}
          </div>
          {validateUrl ? (
            <RulesetPreviewPanel
              validateUrl={validateUrl}
              scoreFormula={scoreFormula}
              constants={constants}
              tiebreakers={tiebreakers}
              doublePenaltyFormula={doublePenaltyFormula}
              targets={targets}
            />
          ) : (
            <ScorePreviewChip constants={constants} />
          )}
        </div>
      )}

      <DoublePenaltyEditor
        value={doublePenaltyFormula}
        onChange={setDoublePenaltyFormula}
        disabled={disabled}
      />

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('admin.srcComponents.matchFormatDefaultsTitle')}
        </h3>
        <p className="mb-3 text-xs text-muted">
          {t('admin.srcComponents.matchFormatDefaultsHelp')}
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <NumberInput
            label={t('admin.srcComponents.pointCapLabel')}
            value={matchFormatDefaults.pointCap}
            disabled={disabled}
            min={1}
            max={50}
            onChange={(n) => setMatchFormatDefaults({ ...matchFormatDefaults, pointCap: n })}
          />
          <SelectInput
            label={t('admin.srcComponents.timerModeLabel')}
            value={matchFormatDefaults.timerMode}
            disabled={disabled}
            options={[
              { value: 'countdown', label: 'Countdown' },
              { value: 'countup', label: 'Count-up' },
            ]}
            onChange={(v) =>
              setMatchFormatDefaults({
                ...matchFormatDefaults,
                timerMode: v as 'countdown' | 'countup',
              })
            }
          />
          <SelectInput
            label={t('admin.srcComponents.scoringDirectionLabel')}
            value={matchFormatDefaults.scoringDirection}
            disabled={disabled}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'reverse_zero_loses', label: 'Reverse (zero loses)' },
            ]}
            onChange={(v) =>
              setMatchFormatDefaults({
                ...matchFormatDefaults,
                scoringDirection: v as 'normal' | 'reverse_zero_loses',
              })
            }
          />
          <NumberInput
            label={t('admin.srcComponents.timeLimitPoolLabel')}
            value={matchFormatDefaults.timeLimitsSeconds.pool ?? 0}
            disabled={disabled}
            min={0}
            max={3600}
            onChange={(n) =>
              setMatchFormatDefaults({
                ...matchFormatDefaults,
                timeLimitsSeconds: { ...matchFormatDefaults.timeLimitsSeconds, pool: n || null },
              })
            }
          />
          <NumberInput
            label={t('admin.srcComponents.timeLimitBracketLabel')}
            value={matchFormatDefaults.timeLimitsSeconds.bracket ?? 0}
            disabled={disabled}
            min={0}
            max={3600}
            onChange={(n) =>
              setMatchFormatDefaults({
                ...matchFormatDefaults,
                timeLimitsSeconds: { ...matchFormatDefaults.timeLimitsSeconds, bracket: n || null },
              })
            }
          />
          <NumberInput
            label={t('admin.srcComponents.timeLimitFinalsLabel')}
            value={matchFormatDefaults.timeLimitsSeconds.finals ?? 0}
            disabled={disabled}
            min={0}
            max={3600}
            onChange={(n) =>
              setMatchFormatDefaults({
                ...matchFormatDefaults,
                timeLimitsSeconds: { ...matchFormatDefaults.timeLimitsSeconds, finals: n || null },
              })
            }
          />
          <NumberInput
            label={t('admin.srcComponents.softClockLabel')}
            value={matchFormatDefaults.softClockLimitSeconds}
            disabled={disabled}
            min={0}
            max={600}
            onChange={(n) =>
              setMatchFormatDefaults({ ...matchFormatDefaults, softClockLimitSeconds: n })
            }
          />
          <NumberInput
            label={t('admin.srcComponents.maxDoubleHitsLabel')}
            value={matchFormatDefaults.maxDoubleHits ?? 0}
            disabled={disabled}
            min={0}
            max={20}
            onChange={(n) =>
              setMatchFormatDefaults({ ...matchFormatDefaults, maxDoubleHits: n || null })
            }
          />
        </div>
      </div>

      {!isCoded && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.formulaTitle')}
          </h3>
          <p className="mb-2 text-xs text-muted">{t('admin.rulesets.formulaHelp')}</p>
          <FormulaEditor
            value={scoreFormula}
            onChange={(ast, err) => {
              setScoreFormula(ast);
              setFormulaError(err);
            }}
            disabled={disabled}
          />
        </div>
      )}

      {!isCoded && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.tiebreakersTitle')}
          </h3>
          <p className="mb-2 text-xs text-muted">{t('admin.rulesets.tiebreakersHelp')}</p>
          <TiebreakersEditor
            value={tiebreakers}
            onChange={setTiebreakers}
            disabled={disabled}
            systemFallback={systemRankingChain}
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? t('admin.rulesets.saving') : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background"
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
    <div className="rounded-md border border-border bg-background p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
          {t('admin.rulesets.systemPanelTitle')}
        </h3>
        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
          {t('admin.rulesets.systemPanelReadOnlyBadge')}
        </span>
      </div>

      {metadata.scoreFormula && (
        <div className="mb-3 rounded-md border border-border bg-surface px-3 py-2">
          <dt className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.rulesets.systemPanelScoreFormula')}
          </dt>
          <dd className="mt-1 font-mono text-sm text-foreground">{metadata.scoreFormula}</dd>
        </div>
      )}

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
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
            {t('admin.rulesets.systemPanelTiebreakers')}
          </p>
          <ol className="space-y-1 text-sm text-foreground">
            {rankingChain.map((rule, idx) => (
              <li
                key={`${rule.key}-${idx}`}
                className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="w-6 font-mono text-xs text-muted">{idx + 1}.</span>
                <span className="font-medium">{formatRankingKey(rule.key)}</span>
                <span className="ml-auto rounded bg-background px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
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
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block text-xs font-semibold text-foreground-secondary">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm disabled:bg-background"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs font-semibold text-foreground-secondary">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
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
  const { t } = useI18n();
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
    <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground-secondary">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.srcComponents.previewLabel')}
      </span>
      <span>
        {t('admin.srcComponents.previewFormula', { wins, ties, losses, doubles })}{' '}
        <span className="font-mono font-semibold text-foreground">{score.toFixed(2)}</span>{' '}
        {t('admin.srcComponents.previewPts')}
      </span>
    </div>
  );
}
