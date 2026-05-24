'use client';

import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { PenaltyEntriesEditor, type PenaltyEntryDraft } from './PenaltyEntriesEditor';

export type AccumulationScope = 'match' | 'phase' | 'tournament';
export type BlackCardForfeitScope = 'match' | 'tournament' | 'none';

export interface PenaltyRulesetFormValue {
  name: string;
  description: string;
  code: string;
  version: string;
  accumulationScope: AccumulationScope;
  publicVisibility: boolean;
  entries: PenaltyEntryDraft[];
  /** Score delta applied per card (default 0 / -1 / 0). */
  yellowCardPoints: number;
  redCardPoints: number;
  blackCardPoints: number;
  /** Scope of the forfeit triggered by 1st / 2nd+ black card. */
  firstBlackCardForfeit: BlackCardForfeitScope;
  secondBlackCardForfeit: BlackCardForfeitScope;
}

export const DEFAULT_PENALTY_RULESET_FORM_VALUES = {
  yellowCardPoints: 0,
  redCardPoints: -1,
  blackCardPoints: 0,
  firstBlackCardForfeit: 'match' as BlackCardForfeitScope,
  secondBlackCardForfeit: 'tournament' as BlackCardForfeitScope,
} as const;

interface Props {
  initial: PenaltyRulesetFormValue;
  /** True on the edit page when the row is built-in and the viewer isn't a
   *  super-admin. Disables everything; identity fields stay visible read-only. */
  disabled?: boolean;
  /** True when editing — code + version become read-only since they're part
   *  of the UNIQUE(code,version,owner) constraint and shouldn't migrate. */
  codeLocked?: boolean;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (value: PenaltyRulesetFormValue) => void;
  onCancel?: () => void;
}

const SCOPE_OPTIONS: AccumulationScope[] = ['match', 'phase', 'tournament'];
const FORFEIT_SCOPE_OPTIONS: BlackCardForfeitScope[] = ['match', 'tournament', 'none'];

export function PenaltyRulesetForm({
  initial,
  disabled,
  codeLocked,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [code, setCode] = useState(initial.code);
  const [version, setVersion] = useState(initial.version);
  const [accumulationScope, setAccumulationScope] = useState<AccumulationScope>(
    initial.accumulationScope,
  );
  const [publicVisibility, setPublicVisibility] = useState(initial.publicVisibility);
  const [entries, setEntries] = useState<PenaltyEntryDraft[]>(initial.entries);
  const [yellowCardPoints, setYellowCardPoints] = useState<number>(initial.yellowCardPoints);
  const [redCardPoints, setRedCardPoints] = useState<number>(initial.redCardPoints);
  const [blackCardPoints, setBlackCardPoints] = useState<number>(initial.blackCardPoints);
  const [firstBlackCardForfeit, setFirstBlackCardForfeit] = useState<BlackCardForfeitScope>(
    initial.firstBlackCardForfeit,
  );
  const [secondBlackCardForfeit, setSecondBlackCardForfeit] = useState<BlackCardForfeitScope>(
    initial.secondBlackCardForfeit,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (!name.trim()) {
      setValidationError(t('admin.rulesets.nameRequired'));
      return;
    }
    if (!code.trim() || !version.trim()) {
      setValidationError(t('admin.penaltyRulesets.codeVersionRequired'));
      return;
    }
    setValidationError(null);
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      code: code.trim(),
      version: version.trim(),
      accumulationScope,
      publicVisibility,
      entries,
      yellowCardPoints,
      redCardPoints,
      blackCardPoints,
      firstBlackCardForfeit,
      secondBlackCardForfeit,
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
              maxLength={200}
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
              disabled={disabled || codeLocked}
              placeholder="2026"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            {t('admin.penaltyRulesets.codeLabel')}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={disabled || codeLocked}
              placeholder="my_org_penalties"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            {t('admin.penaltyRulesets.accumulationLabel')}
            <select
              value={accumulationScope}
              onChange={(e) => setAccumulationScope(e.target.value as AccumulationScope)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.penaltyRulesets.scope.${s}`)}
                </option>
              ))}
            </select>
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
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={publicVisibility}
            onChange={(e) => setPublicVisibility(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-800 focus:ring-2 focus:ring-red-800/30"
          />
          {t('admin.penaltyRulesets.publicVisibilityLabel')}
        </label>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.penaltyRulesets.cardCostsTitle')}
        </h3>
        <p className="mb-3 text-xs text-slate-500">{t('admin.penaltyRulesets.cardCostsHelp')}</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-xs font-semibold text-slate-700">
            {t('admin.penaltyRulesets.yellowCardPoints')}
            <input
              type="number"
              step={1}
              value={yellowCardPoints}
              onChange={(e) => setYellowCardPoints(Number.parseInt(e.target.value, 10) || 0)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            {t('admin.penaltyRulesets.redCardPoints')}
            <input
              type="number"
              step={1}
              value={redCardPoints}
              onChange={(e) => setRedCardPoints(Number.parseInt(e.target.value, 10) || 0)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            {t('admin.penaltyRulesets.blackCardPoints')}
            <input
              type="number"
              step={1}
              value={blackCardPoints}
              onChange={(e) => setBlackCardPoints(Number.parseInt(e.target.value, 10) || 0)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-100"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-700">
            {t('admin.penaltyRulesets.firstBlackCardForfeit')}
            <select
              value={firstBlackCardForfeit}
              onChange={(e) => setFirstBlackCardForfeit(e.target.value as BlackCardForfeitScope)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              {FORFEIT_SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.penaltyRulesets.forfeitScope.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            {t('admin.penaltyRulesets.secondBlackCardForfeit')}
            <select
              value={secondBlackCardForfeit}
              onChange={(e) => setSecondBlackCardForfeit(e.target.value as BlackCardForfeitScope)}
              disabled={disabled}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            >
              {FORFEIT_SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.penaltyRulesets.forfeitScope.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('admin.penaltyRulesets.entriesTitle')}
        </h3>
        <p className="mb-2 text-xs text-slate-500">{t('admin.penaltyRulesets.entriesHelp')}</p>
        <PenaltyEntriesEditor value={entries} disabled={disabled} onChange={setEntries} />
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
