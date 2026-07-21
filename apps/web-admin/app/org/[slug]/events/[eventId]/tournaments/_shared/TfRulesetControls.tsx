'use client';

import { type ReactNode } from 'react';
import { t } from '@myclash/i18n';
import { Button } from '@myclash/ui';
import { TF_DEFAULTS, type RulesetConfigTF } from '../new/_wizard/buildTfFromRow';

/**
 * The TF-family ruleset controls, shared by the create wizard (Step 4) and the
 * tournament settings Advanced tab.
 *
 * Two kinds of field live here and are governed differently:
 *   - the RULESET CONSTANTS (winBonus / deep / shallow) ARE the format. On the
 *     locked built-in they are read-only + greyed, with "Customise this format"
 *     to fork into an editable org copy. On a fork they edit freely.
 *   - the tournamentPolicy switches are NOT ruleset constants (they are per-
 *     tournament organiser policy), so they stay editable regardless of `locked`.
 */
export function TfRulesetControls({
  tf,
  onChange,
  locked,
  onCustomise,
  customising,
}: {
  tf: RulesetConfigTF;
  onChange: (next: RulesetConfigTF) => void;
  /** True when the tournament still points at the locked built-in format. */
  locked: boolean;
  onCustomise?: () => void;
  customising?: boolean;
}) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-2 text-xs font-medium text-foreground-secondary">
        {t('admin.orgTournaments.tfRulesetLegend')}
      </legend>

      {locked ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          <p className="text-xs text-muted">{t('admin.orgTournaments.formatLockedHint')}</p>
          {onCustomise && (
            <Button type="button" variant="secondary" onClick={onCustomise} disabled={customising}>
              {customising ? t('common.saving') : t('admin.orgTournaments.customiseFormat')}
            </Button>
          )}
        </div>
      ) : (
        <p className="px-2 pb-1 text-xs text-muted">{t('admin.orgTournaments.tfRulesetHint')}</p>
      )}

      <TfConstantFields tf={tf} onChange={onChange} disabled={locked} />
      <TfPolicyFields tf={tf} onChange={onChange} />
    </fieldset>
  );
}

/** winBonus / deep / shallow — the ruleset constants, greyed while `disabled`. */
function TfConstantFields({
  tf,
  onChange,
  disabled,
}: {
  tf: RulesetConfigTF;
  onChange: (next: RulesetConfigTF) => void;
  disabled: boolean;
}) {
  const setTarget = (key: 'deepTarget' | 'shallowTarget', v: number) =>
    onChange({ ...tf, targetValues: { ...tf.targetValues, [key]: v } });
  return (
    <>
      <NumField
        label={t('admin.orgTournaments.winBonus')}
        value={tf.winBonus}
        defaultValue={TF_DEFAULTS.winBonus}
        onChange={(v) => onChange({ ...tf, winBonus: v })}
        min={0}
        max={20}
        disabled={disabled}
      />
      <NumField
        label={t('admin.orgTournaments.deepTarget')}
        value={tf.targetValues.deepTarget}
        defaultValue={TF_DEFAULTS.targetValues.deepTarget}
        onChange={(v) => setTarget('deepTarget', v)}
        min={1}
        max={10}
        disabled={disabled}
      />
      <NumField
        label={t('admin.orgTournaments.shallowTarget')}
        value={tf.targetValues.shallowTarget}
        defaultValue={TF_DEFAULTS.targetValues.shallowTarget}
        onChange={(v) => setTarget('shallowTarget', v)}
        min={1}
        max={10}
        disabled={disabled}
      />
    </>
  );
}

/** Per-tournament organiser policy — always editable, even on the built-in. */
function TfPolicyFields({
  tf,
  onChange,
}: {
  tf: RulesetConfigTF;
  onChange: (next: RulesetConfigTF) => void;
}) {
  const setPolicy = (patch: Partial<RulesetConfigTF['tournamentPolicy']>) =>
    onChange({ ...tf, tournamentPolicy: { ...tf.tournamentPolicy, ...patch } });
  return (
    <>
      <BoolField
        label={t('admin.orgTournaments.forfeitDrawsCount')}
        value={tf.tournamentPolicy.forfeitDrawsCount}
        defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitDrawsCount}
        onChange={(v) => setPolicy({ forfeitDrawsCount: v })}
      />
      <BoolField
        label={t('admin.orgTournaments.forfeitBeforeFirstMatchDq')}
        value={tf.tournamentPolicy.forfeitFighterBefore1stMatch}
        defaultValue={TF_DEFAULTS.tournamentPolicy.forfeitFighterBefore1stMatch}
        onChange={(v) => setPolicy({ forfeitFighterBefore1stMatch: v })}
      />
      <NumField
        label={t('admin.orgTournaments.disqualifyAfter')}
        value={tf.tournamentPolicy.disqualifyAfter}
        defaultValue={TF_DEFAULTS.tournamentPolicy.disqualifyAfter}
        onChange={(v) => setPolicy({ disqualifyAfter: v })}
        min={1}
        max={10}
      />
    </>
  );
}

function FieldRow({
  label,
  badge,
  control,
}: {
  label: string;
  badge: ReactNode;
  control: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        {label}
        {badge}
      </span>
      <span className="flex items-center gap-2">{control}</span>
    </label>
  );
}

/** A "modified" chip + a reset-to-default link, shown only when value ≠ default. */
function DefaultAffordance({
  modified,
  defaultLabel,
  onReset,
}: {
  modified: boolean;
  defaultLabel: string;
  onReset: () => void;
}) {
  if (!modified) return null;
  return (
    <button
      type="button"
      onClick={onReset}
      className="text-xs text-muted underline hover:text-foreground"
      title={`Reset to ${defaultLabel}`}
    >
      {t('admin.orgTournaments.reset')}
    </button>
  );
}

function ModifiedBadge({ show, defaultLabel }: { show: boolean; defaultLabel: string }) {
  if (!show) return null;
  return (
    <span
      title={`Default: ${defaultLabel}`}
      className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning"
    >
      {t('admin.orgTournaments.modifiedBadge')}
    </span>
  );
}

function NumField({
  label,
  value,
  defaultValue,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const modified = !disabled && value !== defaultValue;
  return (
    <FieldRow
      label={label}
      badge={<ModifiedBadge show={modified} defaultLabel={String(defaultValue)} />}
      control={
        <>
          <DefaultAffordance
            modified={modified}
            defaultLabel={String(defaultValue)}
            onReset={() => onChange(defaultValue)}
          />
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-24 rounded-md border border-border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          />
        </>
      }
    />
  );
}

function BoolField({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: boolean;
  defaultValue: boolean;
  onChange: (v: boolean) => void;
}) {
  const modified = value !== defaultValue;
  return (
    <FieldRow
      label={label}
      badge={<ModifiedBadge show={modified} defaultLabel={String(defaultValue)} />}
      control={
        <>
          <DefaultAffordance
            modified={modified}
            defaultLabel={String(defaultValue)}
            onReset={() => onChange(defaultValue)}
          />
          <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        </>
      }
    />
  );
}
