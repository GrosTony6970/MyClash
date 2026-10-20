'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useId, type ReactNode } from 'react';
import { Button } from '@myclash/ui';
import { startAffordance } from './start-affordance';
import type { RulesetConfigTF } from './tf-form';

/**
 * The TF-family ruleset controls, shared by the create wizard (Step 4) and the
 * tournament settings Advanced tab.
 *
 * The RULESET CONSTANTS (winBonus / deep / shallow) ARE the format. On the locked built-in they
 * are read-only + greyed, with "Customise this format" to fork into an editable org copy. On a
 * fork they edit freely. No forfeit rule is here: the penalty ruleset owns them (rulings 63, 68).
 *
 * The "modified" badge and Reset compare with what the ruleset starts a Tournament from at its
 * pinned version (`start`, operator ruling 51); with no `start`, neither shows.
 */
export function TfRulesetControls({
  tf,
  start,
  onChange,
  locked,
  onCustomise,
  customising,
  readOnly,
}: {
  tf: RulesetConfigTF;
  start: RulesetConfigTF | null;
  onChange: (next: RulesetConfigTF) => void;
  /** True when the tournament still points at the locked built-in format. */
  locked: boolean;
  onCustomise?: () => void;
  customising?: boolean;
  /** The Event is archived: the server refuses the fork, so its button is closed. */
  readOnly: boolean;
}) {
  const { t } = useI18n();

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-2 text-xs font-medium text-foreground-secondary">
        {t('admin.orgTournaments.tfRulesetLegend')}
      </legend>

      {locked ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          <p className="text-xs text-muted">{t('admin.orgTournaments.formatLockedHint')}</p>
          {onCustomise && (
            <Button
              type="button"
              variant="secondary"
              onClick={onCustomise}
              disabled={customising || readOnly}
            >
              {customising ? t('common.saving') : t('admin.orgTournaments.customiseFormat')}
            </Button>
          )}
        </div>
      ) : (
        <p className="px-2 pb-1 text-xs text-muted">{t('admin.orgTournaments.tfRulesetHint')}</p>
      )}

      <TfConstantFields tf={tf} start={start} onChange={onChange} disabled={locked} />
    </fieldset>
  );
}

interface FieldsProps {
  tf: RulesetConfigTF;
  start: RulesetConfigTF | null;
  onChange: (next: RulesetConfigTF) => void;
}

/** winBonus / deep / shallow — the ruleset constants, greyed while `disabled`. */
function TfConstantFields({ tf, start, onChange, disabled }: FieldsProps & { disabled: boolean }) {
  const { t } = useI18n();

  const setTarget = (key: 'deepTarget' | 'shallowTarget', v: number) =>
    onChange({ ...tf, targetValues: { ...tf.targetValues, [key]: v } });
  return (
    <>
      <NumField
        label={t('admin.orgTournaments.winBonus')}
        value={tf.winBonus}
        start={start?.winBonus}
        onChange={(v) => onChange({ ...tf, winBonus: v })}
        min={0}
        max={20}
        disabled={disabled}
      />
      <NumField
        label={t('admin.orgTournaments.deepTarget')}
        value={tf.targetValues.deepTarget}
        start={start?.targetValues.deepTarget}
        onChange={(v) => setTarget('deepTarget', v)}
        min={1}
        max={10}
        disabled={disabled}
      />
      <NumField
        label={t('admin.orgTournaments.shallowTarget')}
        value={tf.targetValues.shallowTarget}
        start={start?.targetValues.shallowTarget}
        onChange={(v) => setTarget('shallowTarget', v)}
        min={1}
        max={10}
        disabled={disabled}
      />
    </>
  );
}

/**
 * A field's row: its name, linked to the control by id, with the badge; the Reset and the control.
 * Not one `<label>` around all of it: a Reset button inside would become what clicking the name
 * presses.
 */
function FieldRow({
  id,
  label,
  badge,
  control,
}: {
  id: string;
  label: string;
  badge: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm text-foreground-secondary">
        <label htmlFor={id}>{label}</label>
        {badge}
      </span>
      <span className="flex items-center gap-2">{control}</span>
    </div>
  );
}

function NumField({
  label,
  value,
  start,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  start: number | undefined;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const id = useId();
  const shown = startAffordance(value, disabled ? undefined : start, String, onChange);
  return (
    <FieldRow
      id={id}
      label={label}
      badge={shown.badge}
      control={
        <>
          {shown.reset}
          <input
            id={id}
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
