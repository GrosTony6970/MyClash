'use client';

import { useState } from 'react';
import type { FormulaConfig, FormulaConstants, FormulaNode, Tiebreaker } from '@myclash/rulesets';
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
  onSubmit: (
    config: { name: string; description: string; version: string } & FormulaConfig,
  ) => void;
  onCancel?: () => void;
}

export function RulesetForm({ initial, disabled, busy, submitLabel, onSubmit, onCancel }: Props) {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {validationError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {validationError}
        </div>
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
        <TiebreakersEditor value={tiebreakers} onChange={setTiebreakers} disabled={disabled} />
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
