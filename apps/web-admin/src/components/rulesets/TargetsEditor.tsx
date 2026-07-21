'use client';

import { MAX_TARGETS, MAX_AUTHORED_TARGET_VALUE, type Target } from '@myclash/rulesets';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  value: Target[];
  onChange: (next: Target[]) => void;
  disabled?: boolean;
}

/**
 * The grammar half of a ruleset: what an exchange can be and what it is worth.
 * A list of named targets, replacing TF_v1's two anonymous deep/shallow slots.
 *
 * Bounds mirror the engine's AuthoredTargetsSchema exactly, so a save never
 * 400s on a value the form allowed: 1..8 targets, value 1..10 (the exchange
 * cap), name 1..40. Target NAMES are operator data rendered raw — never i18n.
 */
export function TargetsEditor({ value, onChange, disabled }: Props) {
  const { t } = useI18n();

  function update(idx: number, patch: Partial<Target>) {
    if (disabled) return;
    onChange(value.map((target, i) => (i === idx ? { ...target, ...patch } : target)));
  }
  function remove(idx: number) {
    // The last target is never removable (empty list 400s AuthoredTargetsSchema);
    // TargetRow disables its own button, this guards the path anyway.
    if (disabled || value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    if (disabled || value.length >= MAX_TARGETS) return;
    onChange([...value, { name: '', value: 1 }]);
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-2 grid grid-cols-[1fr_6rem_2rem] gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span>{t('admin.rulesets.targetNameHeader')}</span>
        <span>{t('admin.rulesets.targetValueHeader')}</span>
        <span className="sr-only">{t('admin.rulesets.removeTarget')}</span>
      </div>
      <ul className="space-y-2">
        {value.map((target, idx) => (
          <TargetRow
            key={idx}
            target={target}
            disabled={disabled}
            canRemove={value.length > 1}
            onChange={(patch) => update(idx, patch)}
            onRemove={() => remove(idx)}
          />
        ))}
      </ul>
      {value.length >= MAX_TARGETS ? (
        <p className="mt-2 text-xs text-muted">{t('admin.rulesets.targetCountMax')}</p>
      ) : (
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
        >
          {t('admin.rulesets.addTarget')}
        </button>
      )}
    </div>
  );
}

function TargetRow({
  target,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  target: Target;
  disabled?: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<Target>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <li className="grid grid-cols-[1fr_6rem_2rem] items-center gap-2">
      <input
        type="text"
        value={target.name}
        maxLength={40}
        placeholder={t('admin.rulesets.targetNamePlaceholder')}
        disabled={disabled}
        onChange={(e) => onChange({ name: e.target.value })}
        className="w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
      />
      <input
        type="number"
        value={target.value}
        min={1}
        max={MAX_AUTHORED_TARGET_VALUE}
        disabled={disabled}
        onChange={(e) => onChange({ value: Number(e.target.value) })}
        className="w-full rounded-md border border-border px-3 py-2 font-mono text-sm disabled:bg-background"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled || !canRemove}
        aria-label={t('admin.rulesets.removeTarget')}
        className="rounded-md border border-border px-2 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-30"
      >
        ×
      </button>
    </li>
  );
}
