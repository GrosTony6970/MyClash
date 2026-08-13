'use client';

import { MAX_AUTHORED_TARGET_VALUE } from '@myclash/rulesets';
import { HelpTooltip } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { rulesetHelp } from './rulesetHelp';

export interface AfterblowGrammar {
  hasAfterblow: boolean;
  afterblowValuation: 'fixed' | 'weighted';
  afterblowFixedValue: number;
  afterblowMode: 'full' | 'deductive';
}

export const DEFAULT_AFTERBLOW_GRAMMAR: AfterblowGrammar = {
  hasAfterblow: false,
  afterblowValuation: 'fixed',
  afterblowFixedValue: 1,
  afterblowMode: 'full',
};

interface Props {
  value: AfterblowGrammar;
  onChange: (next: AfterblowGrammar) => void;
  disabled?: boolean;
}

/**
 * Whether a ruleset uses afterblow, and how the retaliation is worth points.
 *
 *  - `fixed`    — the retaliation is always worth `afterblowFixedValue`
 *                 (FFAMHE's rule) → one afterblow button per target.
 *  - `weighted` — the retaliation is worth the target it hit → the full
 *                 attacker × defender button grid.
 *
 * The three dependents only appear once afterblow is on; the fixed value only
 * once the valuation is `fixed`. `afterblowMode` seeds a new tournament and is
 * overridable there, so it is labelled as a default.
 */
export function AfterblowGrammarEditor({ value, onChange, disabled }: Props) {
  const { t } = useI18n();

  function set(patch: Partial<AfterblowGrammar>) {
    if (disabled) return;
    onChange({ ...value, ...patch });
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4 space-y-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
        <input
          type="checkbox"
          checked={value.hasAfterblow}
          disabled={disabled}
          onChange={(e) => set({ hasAfterblow: e.target.checked })}
        />
        {t('admin.rulesets.hasAfterblowLabel')}
      </label>

      {value.hasAfterblow && <AfterblowDetails value={value} disabled={disabled} onChange={set} />}
    </div>
  );
}

/** The controls that only mean anything once afterblow is on. */
function AfterblowDetails({
  value,
  disabled,
  onChange,
}: {
  value: AfterblowGrammar;
  disabled?: boolean;
  onChange: (patch: Partial<AfterblowGrammar>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="block text-xs font-semibold text-foreground-secondary">
        {t('admin.rulesets.afterblowValuationLabel')}
        <HelpTooltip text={rulesetHelp('afterblowValuation', t)} />
        <select
          value={value.afterblowValuation}
          disabled={disabled}
          onChange={(e) => onChange({ afterblowValuation: e.target.value as 'fixed' | 'weighted' })}
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
        >
          <option value="fixed">{t('admin.rulesets.afterblowValuationFixed')}</option>
          <option value="weighted">{t('admin.rulesets.afterblowValuationWeighted')}</option>
        </select>
      </label>

      {value.afterblowValuation === 'fixed' && (
        <label className="block text-xs font-semibold text-foreground-secondary">
          {t('admin.rulesets.afterblowFixedValueLabel')}
          <input
            type="number"
            value={value.afterblowFixedValue}
            min={1}
            max={MAX_AUTHORED_TARGET_VALUE}
            disabled={disabled}
            onChange={(e) => onChange({ afterblowFixedValue: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm disabled:bg-background"
          />
        </label>
      )}

      <label className="block text-xs font-semibold text-foreground-secondary">
        {t('admin.rulesets.afterblowModeLabel')}
        <HelpTooltip text={rulesetHelp('afterblowMode', t)} />
        <select
          value={value.afterblowMode}
          disabled={disabled}
          onChange={(e) => onChange({ afterblowMode: e.target.value as 'full' | 'deductive' })}
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
        >
          <option value="full">{t('admin.rulesets.afterblowModeFull')}</option>
          <option value="deductive">{t('admin.rulesets.afterblowModeDeductive')}</option>
        </select>
      </label>
    </div>
  );
}
