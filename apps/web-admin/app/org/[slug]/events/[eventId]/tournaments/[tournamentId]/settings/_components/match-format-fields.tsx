'use client';

import { useId } from 'react';
import type { Translator } from '@myclash/next-i18n/client';
import type { WizardMatchFormat } from '../../../_shared/match-format-form';
import { startAffordance } from '../../../_shared/start-affordance';

/**
 * The Match format tab's fields: a name linked to its control by id, with the "modified" badge
 * and Reset beside it. Their own file so the tab stays inside the file-size budget.
 */

/**
 * A field's name, linked to its control by id, with the "modified" badge and Reset beside it
 * (`startAffordance`, outside the `<label>`). A null start value (no limit) reads as the 0 the
 * field shows for it, and Reset puts the null back.
 */
function FieldHead<T>({
  id,
  label,
  value,
  start,
  onReset,
  describe = (s) => String(s ?? 0),
}: {
  id: string;
  label: string;
  value: T;
  start: T | undefined;
  onReset: (v: T) => void;
  /** How the start value reads in the badge's words. */
  describe?: (s: T) => string;
}) {
  const shown = startAffordance(value, start, describe, onReset);
  return (
    <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground-secondary">
      <label htmlFor={id}>{label}</label>
      {shown.badge}
      <span className="ml-auto">{shown.reset}</span>
    </div>
  );
}

/** A number; a nullable one (a time limit, the doubles ceiling) shows its null as 0. */
export function NumberField<T extends number | null>({
  label,
  value,
  defaultValue,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: T;
  /** What the ruleset starts from; Reset puts it back. None: no badge, no Reset. */
  defaultValue?: T;
  onChange: (v: T) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead id={id} label={label} value={value} start={defaultValue} onReset={onChange} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          value={value ?? 0}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value) as T)}
          className="w-32 rounded-md border border-border px-3 py-2 text-sm"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  defaultValue,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  /** What the ruleset starts from; Reset puts it back. None: no badge, no Reset. */
  defaultValue?: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead id={id} label={label} value={value} start={defaultValue} onReset={onChange} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A yes/no setting; its badge and Reset read the start value as "on" / "off". */
export function CheckField({
  label,
  checked,
  defaultValue,
  onChange,
  hint,
  on,
  off,
}: {
  label: string;
  checked: boolean;
  defaultValue?: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  /** The words the badge shows for a start of yes and of no. */
  on: string;
  off: string;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead
        id={id}
        label={label}
        value={checked}
        start={defaultValue}
        onReset={onChange}
        describe={(s) => (s ? on : off)}
      />
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const PHASES = ['pool', 'bracket', 'finals'] as const;

/** Venues mode: the won venues that end a round, per phase, and whether a decided round stops. */
export function VenuesFields({
  data,
  start,
  set,
  t,
}: {
  data: WizardMatchFormat;
  /** What the ruleset starts from; none: no badge, no Reset. */
  start: WizardMatchFormat | null;
  set: (next: Partial<WizardMatchFormat>) => void;
  t: Translator;
}) {
  const labels = {
    pool: t('organizer.tournaments.settings.venuesPerRoundPool'),
    bracket: t('organizer.tournaments.settings.venuesPerRoundBracket'),
    finals: t('organizer.tournaments.settings.venuesPerRoundFinals'),
  };
  return (
    <>
      {PHASES.map((phase) => (
        <NumberField
          key={phase}
          label={labels[phase]}
          value={data.venuesPerRound[phase]}
          defaultValue={start?.venuesPerRound[phase]}
          onChange={(v) => set({ venuesPerRound: { ...data.venuesPerRound, [phase]: v } })}
          min={1}
          max={50}
        />
      ))}
      <CheckField
        label={t('organizer.tournaments.settings.stopWhenDecidedLabel')}
        hint={t('organizer.tournaments.settings.stopWhenDecidedHelp')}
        checked={data.stopWhenDecided}
        defaultValue={start?.stopWhenDecided}
        onChange={(v) => set({ stopWhenDecided: v })}
        on={t('admin.common.yes')}
        off={t('admin.common.no')}
      />
    </>
  );
}
