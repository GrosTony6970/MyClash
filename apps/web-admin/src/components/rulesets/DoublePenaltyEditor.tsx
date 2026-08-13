'use client';

import {
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  FEDERAL_DOUBLE_PENALTY_AST,
  isDoublePenaltyAst,
  type DoublePenaltySpec,
  type FormulaNode,
} from '@myclash/rulesets';
import { HelpTooltip } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { rulesetHelp } from './rulesetHelp';
import { FormulaEditor } from './FormulaEditor';

interface Props {
  value: DoublePenaltySpec | null;
  onChange: (next: DoublePenaltySpec | null) => void;
  disabled?: boolean;
}

const NONE = '__none__';
const CUSTOM = '__custom__';

/**
 * The optional named double-hit penalty. Authored once here and referenced by
 * the score formula through the `doublePenalty` variable, so a nonlinear
 * penalty need not be inlined in the score.
 *
 * A preset (whitelist KEY) or a custom AST. The AST editor is the shared
 * FormulaEditor restricted to `doubleHits` (TF_v1's `n`), so a penalty term
 * cannot reference stats that are meaningless in it. Keys stay available as
 * presets because `n` (max(0,n)) and `0` cannot be expressed as an AST.
 */
export function DoublePenaltyEditor({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const isAst = value != null && isDoublePenaltyAst(value);
  const selection = value == null ? NONE : isAst ? CUSTOM : value;

  function onSelect(next: string) {
    if (next === NONE) return onChange(null);
    if (next === CUSTOM) return onChange(FEDERAL_DOUBLE_PENALTY_AST);
    return onChange(next as DoublePenaltySpec);
  }

  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-1 flex items-center text-xs font-semibold uppercase tracking-wider text-muted">
        {t('admin.rulesets.doublePenaltyTitle')}
        <HelpTooltip text={rulesetHelp('doublePenalty', t)} />
      </h3>
      <p className="mb-3 text-xs text-muted">{t('admin.rulesets.doublePenaltyHelp')}</p>

      <PresetSelect value={selection} disabled={disabled} onSelect={onSelect} />

      {isAst && (
        <div className="mt-3">
          <FormulaEditor
            value={value as FormulaNode}
            variables={[DOUBLE_PENALTY_VARIABLE]}
            disabled={disabled}
            // A malformed intermediate leaves the previous valid AST in place;
            // the API re-validates on save, so a bad draft cannot be persisted.
            onChange={(ast) => {
              if (ast) onChange(ast);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Preset keys plus the two synthetic options (none / author your own). */
function PresetSelect({
  value,
  disabled,
  onSelect,
}: {
  value: string;
  disabled?: boolean;
  onSelect: (next: string) => void;
}) {
  const { t } = useI18n();
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onSelect(e.target.value)}
      className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
    >
      <option value={NONE}>{t('admin.rulesets.doublePenaltyNone')}</option>
      {DOUBLE_PENALTY_FORMULA_KEYS.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
      <option value={CUSTOM}>{t('admin.rulesets.doublePenaltyCustom')}</option>
    </select>
  );
}
